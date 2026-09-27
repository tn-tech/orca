import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcDispatcher } from '../rpc/dispatcher'
import {
  APPROVAL_DEFAULT_ANSWERER,
  approvalQuestionOptions
} from '../../../shared/workflows/workflow-approval-question-subject'
import { APPROVAL_TIMED_OUT_REASON } from './workflow-approval-deadlines'
import { resolveApproval } from './workflow-approval-gates'
import { approvalDriver, approvalNode, approvalWorkflow } from './workflow-approval-test-fixtures'
import { createControllerHarness, waitUntil } from './workflow-run-controller-test-harness'
import { WorkflowRunRecorder } from './workflow-run-recorder'

const TIMEOUT_MS = 60_000
const GRACE_MS = 30_000

type EngineRequest = Parameters<RpcDispatcher['dispatchAsWorkflowEngine']>[0]

describe('Approval recovery', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof approvalDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-approval-recovery-'))
    h = createControllerHarness(workspaceRoot)
    d = approvalDriver(h)
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    h.db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  /** Runs `onMatch` instead of the engine call the first time `matches` accepts one. */
  function interceptOnce(
    matches: (request: EngineRequest) => boolean,
    onMatch: (forward: () => Promise<unknown>) => Promise<never>
  ): void {
    const dispatch = h.dispatcher.dispatchAsWorkflowEngine.bind(h.dispatcher)
    let used = false
    vi.spyOn(h.dispatcher, 'dispatchAsWorkflowEngine').mockImplementation(
      async (request, ...rest) => {
        if (!used && matches(request)) {
          used = true
          return onMatch(() => dispatch(request, ...rest))
        }
        return dispatch(request, ...rest)
      }
    )
  }

  const timedRun = (defaultOption?: string) =>
    h.createRun(
      approvalWorkflow(
        approvalNode({
          timeoutMs: TIMEOUT_MS,
          escalationGraceMs: GRACE_MS,
          ...(defaultOption ? { defaultOption } : {})
        }),
        { withSideBranch: false }
      )
    )

  /** Leaves the gate attempt `pending` with its Task and gate, as a runtime stopped mid-open. */
  async function stopMidOpen(runId: string): Promise<void> {
    interceptOnce(
      (request) => request.method === 'orchestration.gateCreate',
      async (forward) => {
        await forward()
        return new Promise<never>(() => {})
      }
    )
    void h.createController(runId).run()
    await waitUntil(() => h.db.listGates({ taskId: d.attempt(runId, 'gate')?.taskId }).length > 0)
  }

  it.each([
    ['Task and gate', false],
    ['Task, gate and question', true]
  ])('reopens an approval interrupted after its %s were written', async (_, withQuestion) => {
    const run = h.createRun(approvalWorkflow(approvalNode(), { withSideBranch: false }))
    await stopMidOpen(run.id)
    const pending = d.attempt(run.id, 'gate')
    expect(pending?.state).toBe('pending')
    const [gate] = h.db.listGates({ taskId: pending?.taskId })
    if (withQuestion) {
      h.db.createWorkflowQuestion({
        runId: run.id,
        attemptId: pending?.id ?? '',
        kind: 'approval',
        gateId: gate?.id,
        prompt: 'Approve the plan?',
        options: approvalQuestionOptions({ options: ['approve', 'reject'] })
      })
    }

    const finished = h.createController(run.id).run()
    await d.reached(run.id, 'gate', 'waiting')
    expect(h.db.listGates({ taskId: pending?.taskId })).toHaveLength(1)
    const questions = h.db.listWorkflowQuestions(run.id)
    expect(questions).toHaveLength(1)
    expect(questions[0]?.gateId).toBe(gate?.id)
    resolveApproval(h.db, h.runtime, {
      runId: run.id,
      questionId: questions[0]?.id ?? '',
      optionId: 'approve',
      answeredBy: 'user_1'
    })
    await d.report(run.id, 'a')
    await expect(finished).resolves.toBe('completed')
  })

  it('fails the node on restart when the runtime stopped right after the question expired', async () => {
    const run = timedRun()
    interceptOnce(
      (request) =>
        request.method === 'orchestration.taskUpdate' &&
        Reflect.get(Object(request.params), 'status') === 'failed',
      async () => {
        throw new Error('runtime stopped')
      }
    )
    // Caught at once: it rejects while the fake clock advances, before the assertion below.
    const first = h
      .createController(run.id)
      .run()
      .catch((error: unknown) => error)
    await d.reached(run.id, 'gate', 'waiting')
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + GRACE_MS)
    expect(await first).toMatchObject({ message: 'runtime stopped' })

    const finished = h.createController(run.id).run()
    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'gate')).toMatchObject({
      state: 'failed',
      failureReason: APPROVAL_TIMED_OUT_REASON
    })
    expect(h.db.getTask(d.attempt(run.id, 'gate')?.taskId ?? '')?.status).toBe('failed')
    expect(d.question(run.id)?.state).toBe('expired')
  })

  it('never loses the escalation event when the runtime stops while recording it', async () => {
    const run = timedRun('reject')
    const append = h.db.appendWorkflowEvent.bind(h.db)
    let thrown = false
    vi.spyOn(h.db, 'appendWorkflowEvent').mockImplementation((event) => {
      if (!thrown && event.kind === 'approval_escalated') {
        thrown = true
        throw new Error('runtime stopped')
      }
      return append(event)
    })
    // Caught at once: it rejects while the fake clock advances, before the assertion below.
    const first = h
      .createController(run.id)
      .run()
      .catch((error: unknown) => error)
    await d.reached(run.id, 'gate', 'waiting')
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(await first).toMatchObject({ message: 'runtime stopped' })

    const controller = h.createController(run.id)
    const finished = controller.run()
    await waitUntil(() => d.question(run.id)?.state === 'escalated')
    await waitUntil(() => d.eventKinds(run.id).includes('approval_escalated'))
    controller.stop()
    await finished
  })

  it('keeps the default when a person answers after it was applied', async () => {
    const run = timedRun('reject')
    const controller = h.createController(run.id)
    const finished = controller.run()
    await d.reached(run.id, 'gate', 'waiting')
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + GRACE_MS)
    await d.reached(run.id, 'b', 'running')
    expect(() =>
      resolveApproval(h.db, h.runtime, {
        runId: run.id,
        questionId: d.question(run.id)?.id ?? '',
        optionId: 'approve',
        answeredBy: 'user_1'
      })
    ).toThrow(expect.objectContaining({ code: 'workflow_question_not_pending' }))
    expect(d.question(run.id)).toMatchObject({
      answer: 'reject',
      answeredBy: APPROVAL_DEFAULT_ANSWERER
    })
    controller.stop()
    await finished
  })

  it('keeps a person’s recorded answer when the default comes due before it is routed', async () => {
    const run = timedRun('reject')
    const first = h.createController(run.id)
    const running = first.run()
    await d.reached(run.id, 'gate', 'waiting')
    first.stop()
    await running
    resolveApproval(h.db, h.runtime, {
      runId: run.id,
      questionId: d.question(run.id)?.id ?? '',
      optionId: 'approve',
      answeredBy: 'user_1'
    })
    vi.setSystemTime(Date.now() + TIMEOUT_MS + GRACE_MS)

    const finished = h.createController(run.id).run()
    await d.report(run.id, 'a')
    await expect(finished).resolves.toBe('completed')
    expect(d.question(run.id)).toMatchObject({ answer: 'approve', answeredBy: 'user_1' })
    expect(d.eventKinds(run.id)).not.toContain('approval_default_applied')
  })

  it('closes open approvals when the run ends and refuses answers afterwards', () => {
    const run = h.createRun(approvalWorkflow())
    const recorder = new WorkflowRunRecorder(h.db, h.runtime, run.id)
    recorder.transitionRun('running', 'run_started')
    const question = h.db.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_open',
      kind: 'approval',
      prompt: 'Approve?',
      options: approvalQuestionOptions({ options: ['approve'] })
    })
    recorder.transitionRun('failed', 'run_failed')
    expect(h.db.listWorkflowQuestions(run.id)[0]?.state).toBe('expired')

    const stale = h.db.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_late',
      kind: 'approval',
      prompt: 'Approve?',
      options: approvalQuestionOptions({ options: ['approve'] })
    })
    expect(() =>
      resolveApproval(h.db, h.runtime, {
        runId: run.id,
        questionId: stale.id,
        optionId: 'approve',
        answeredBy: 'user_1'
      })
    ).toThrow(expect.objectContaining({ code: 'workflow_run_not_active' }))
    expect(question.id).not.toBe(stale.id)
  })
})
