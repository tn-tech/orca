import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPROVAL_DEFAULT_ANSWERER } from '../../../shared/workflows/workflow-approval-question-subject'
import {
  APPROVAL_TIMED_OUT_REASON,
  type WorkflowApprovalEscalationListener
} from './workflow-approval-deadlines'
import { armQuestionDeadlineTimer } from './workflow-question-deadlines'
import { resolveApproval } from './workflow-approval-gates'
import { approvalDriver, approvalNode, approvalWorkflow } from './workflow-approval-test-fixtures'
import { createControllerHarness } from './workflow-run-controller-test-harness'

const TIMEOUT_MS = 60_000
const GRACE_MS = 30_000

describe('Approval timeouts', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof approvalDriver>
  let escalations: Parameters<WorkflowApprovalEscalationListener>[0][]

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-approval-deadlines-'))
    h = createControllerHarness(workspaceRoot)
    d = approvalDriver(h)
    escalations = []
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

  function start(defaultOption?: string) {
    const gate = approvalNode({
      timeoutMs: TIMEOUT_MS,
      escalationGraceMs: GRACE_MS,
      ...(defaultOption ? { defaultOption } : {})
    })
    const run = h.createRun(approvalWorkflow(gate, { withSideBranch: false }))
    const controller = h.createController(run.id, {
      onApprovalEscalated: (question) => escalations.push(question)
    })
    return { run, controller, finished: controller.run() }
  }

  it('escalates at the timeout, then applies the default option after the grace', async () => {
    const { run, finished } = start('reject')
    await d.reached(run.id, 'gate', 'waiting')

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(d.question(run.id)?.state).toBe('escalated')
    expect(escalations.map((question) => question.id)).toEqual([d.question(run.id)?.id])
    expect(d.eventKinds(run.id)).toContain('approval_escalated')
    expect(d.attempt(run.id, 'gate')?.state).toBe('waiting')
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('waiting')

    await vi.advanceTimersByTimeAsync(GRACE_MS)
    await d.report(run.id, 'b')
    await expect(finished).resolves.toBe('completed')
    expect(d.question(run.id)).toMatchObject({
      state: 'answered',
      answer: 'reject',
      answeredBy: APPROVAL_DEFAULT_ANSWERER
    })
    expect(d.attempt(run.id, 'gate')?.resultJson).toEqual({ option: 'reject' })
    expect(d.attempt(run.id, 'a')?.state).toBe('skipped')
    const kinds = d.eventKinds(run.id)
    expect(kinds.indexOf('approval_escalated')).toBeLessThan(
      kinds.indexOf('approval_default_applied')
    )
  })

  it('fails the node and the run when the grace ends with no default option', async () => {
    const { run, finished } = start()
    const waiting = await d.reached(run.id, 'gate', 'waiting')
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + GRACE_MS)
    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'gate')).toMatchObject({
      state: 'failed',
      failureReason: APPROVAL_TIMED_OUT_REASON
    })
    expect(d.question(run.id)?.state).toBe('expired')
    expect(h.db.getGate(d.question(run.id)?.gateId ?? '')?.status).toBe('timeout')
    expect(h.db.getTask(waiting.taskId ?? '')?.status).toBe('failed')
    expect(d.attempt(run.id, 'a')?.state).toBe('skipped')
    expect(escalations).toHaveLength(1)
  })

  it('still accepts a person’s answer during the escalation grace', async () => {
    const { run, controller, finished } = start('reject')
    await d.reached(run.id, 'gate', 'waiting')
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(d.question(run.id)?.state).toBe('escalated')
    resolveApproval(h.db, h.runtime, {
      runId: run.id,
      questionId: d.question(run.id)?.id ?? '',
      optionId: 'approve',
      answeredBy: 'user_1'
    })
    await d.reached(run.id, 'a', 'running')
    expect(d.question(run.id)).toMatchObject({ answer: 'approve', answeredBy: 'user_1' })
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(d.attempt(run.id, 'gate')?.resultJson).toEqual({ option: 'approve' })
    controller.stop()
    await finished
  })

  it('applies deadlines that came due while no controller was running', async () => {
    const first = start('reject')
    await d.reached(first.run.id, 'gate', 'waiting')
    first.controller.stop()
    await expect(first.finished).resolves.toBe('waiting')

    vi.setSystemTime(Date.now() + TIMEOUT_MS + GRACE_MS)
    const finished = h
      .createController(first.run.id, {
        onApprovalEscalated: (question) => escalations.push(question)
      })
      .run()
    await d.report(first.run.id, 'b')
    await expect(finished).resolves.toBe('completed')
    expect(escalations).toHaveLength(1)
    const kinds = d.eventKinds(first.run.id)
    expect(kinds.indexOf('approval_escalated')).toBeLessThan(
      kinds.indexOf('approval_default_applied')
    )
  })

  it('routes an answer recorded while no controller was running', async () => {
    const first = start()
    await d.reached(first.run.id, 'gate', 'waiting')
    first.controller.stop()
    await first.finished
    resolveApproval(h.db, h.runtime, {
      runId: first.run.id,
      questionId: d.question(first.run.id)?.id ?? '',
      optionId: 'approve',
      answeredBy: 'user_1'
    })
    const finished = h.createController(first.run.id).run()
    await d.report(first.run.id, 'a')
    await expect(finished).resolves.toBe('completed')
  })

  it('caps the wake timer instead of letting a long timeout fire at once', () => {
    const run = h.createRun(approvalWorkflow())
    const wake = vi.fn()
    h.db.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_far',
      kind: 'approval',
      prompt: 'Far?',
      escalationAt: Date.now() + 40 * 24 * 3_600_000
    })
    const disarm = armQuestionDeadlineTimer(h.db, run.id, wake)
    vi.advanceTimersByTime(1000)
    expect(wake).not.toHaveBeenCalled()
    disarm()
  })
})
