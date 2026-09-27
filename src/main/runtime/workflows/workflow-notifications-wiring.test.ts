import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { MobileNotificationEvent } from '../runtime-mobile-notification-controller'
import { approvalDriver, approvalNode, approvalWorkflow } from './workflow-approval-test-fixtures'
import type { WorkflowAttention } from './workflow-notifications'
import { WorkflowRunRecorder } from './workflow-run-recorder'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'
import { enterTrustWait } from './workflow-trust-wait'

const TIMEOUT_MS = 60_000
const GRACE_MS = 30_000

describe('workflow-attention wiring', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof approvalDriver>
  let pushed: MobileNotificationEvent[]

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-notifications-wiring-'))
    h = createControllerHarness(workspaceRoot)
    d = approvalDriver(h)
    pushed = []
    h.runtime.onNotificationDispatched((event) => {
      if (event.type === 'notification' && event.source === 'workflow-attention') {
        pushed.push(event)
      }
    })
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

  const titles = () => pushed.map((event) => (event.type === 'notification' ? event.title : ''))

  function startApproval(workflow: Workflow) {
    const run = h.createRun(workflow)
    const controller = h.createController(run.id)
    return { run, controller, finished: controller.run() }
  }

  it('notifies an approval once when raised and once when escalated, not again on rehydrate', async () => {
    const gate = approvalNode({ timeoutMs: TIMEOUT_MS, escalationGraceMs: GRACE_MS })
    const first = startApproval(approvalWorkflow(gate, { withSideBranch: false }))
    await d.reached(first.run.id, 'gate', 'waiting')
    expect(titles()).toEqual(['approval: Approval needed'])

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(d.question(first.run.id)?.state).toBe('escalated')
    expect(titles()).toEqual(['approval: Approval needed', 'approval: Approval overdue'])

    first.controller.stop()
    await first.finished
    const again = h.createController(first.run.id)
    const finished = again.run()
    await waitUntil(() => h.db.listWorkflowEvents(first.run.id).length > 0)
    for (let spins = 0; spins < 100; spins += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    expect(titles()).toEqual(['approval: Approval needed', 'approval: Approval overdue'])
    again.stop()
    await finished
  })

  it('notifies once when the run completes', async () => {
    const { run, finished } = startApproval(
      approvalWorkflow(approvalNode(), { withSideBranch: false })
    )
    await d.reached(run.id, 'gate', 'waiting')
    const { resolveApproval } = await import('./workflow-approval-gates')
    resolveApproval(h.db, h.runtime, {
      runId: run.id,
      questionId: d.question(run.id)?.id ?? '',
      optionId: 'approve',
      answeredBy: 'user_1'
    })
    await d.report(run.id, 'a')
    await expect(finished).resolves.toBe('completed')
    expect(titles()).toEqual(['approval: Approval needed', 'approval: Run completed'])
  })

  it('notifies an agent question the worker raised', async () => {
    const run = h.createRun(TWO_NODE_WORKFLOW)
    const controller = h.createController(run.id)
    const finished = controller.run()
    const implement = await d.reached(run.id, 'implement', 'running')
    const handle = h.db.getWorkerDispatch(implement.dispatchId ?? '')?.agent_terminal_handle ?? ''
    void h.askQuestion({ handle, question: 'Which database?', options: 'postgres,sqlite' })
    await d.reached(run.id, 'implement', 'waiting')
    expect(pushed).toEqual([
      expect.objectContaining({ title: 'two-node: Agent question', body: 'Which database?' })
    ])
    controller.stop()
    await finished
  })
})

describe('recorder workflow-attention seams', () => {
  let h: ReturnType<typeof createControllerHarness>
  let attentions: WorkflowAttention[]
  let recorder: WorkflowRunRecorder
  let runId: string

  beforeEach(() => {
    h = createControllerHarness('/unused')
    attentions = []
    runId = h.createRun().id
    recorder = new WorkflowRunRecorder(
      h.db,
      {
        notifyWorkflowRunChanged: () => {},
        notifyWorkflowAttention: (attention) => attentions.push(attention)
      },
      runId
    )
  })

  afterEach(() => {
    h.db.close()
  })

  it('notifies a trust question once, even when the attempt asks about the same source again', () => {
    recorder.transitionRun('running', 'run_started')
    const attempt = recorder.createAttempt({ id: 'implement', type: 'agent' })
    recorder.transitionAttempt(attempt.id, 'provisioning')
    const question = { source: 'acme@acme', skills: ['deck'], agents: ['claude'] }

    enterTrustWait(h.db, recorder, attempt.id, question)
    recorder.transitionAttempt(attempt.id, 'provisioning')
    enterTrustWait(h.db, recorder, attempt.id, question)

    expect(attentions).toEqual([
      expect.objectContaining({
        kind: 'question-raised',
        run: expect.objectContaining({ id: runId }),
        question: expect.objectContaining({ kind: 'trust' })
      })
    ])
  })

  it('notifies a failed run once', () => {
    recorder.transitionRun('running', 'run_started')
    recorder.transitionRun('failed', 'run_failed')
    expect(() => recorder.transitionRun('failed', 'run_failed')).toThrow()

    expect(attentions).toEqual([
      expect.objectContaining({ kind: 'run-failed', run: expect.objectContaining({ id: runId }) })
    ])
  })

  it('does not notify a cancelled run, which a person asked for', () => {
    recorder.transitionRun('running', 'run_started')
    recorder.transitionRun('cancelled', 'run_cancelled')
    expect(attentions).toEqual([])
  })

  it('never lets a failing notifier break a state change', () => {
    const throwing = new WorkflowRunRecorder(
      h.db,
      {
        notifyWorkflowRunChanged: () => {},
        notifyWorkflowAttention: () => {
          throw new Error('push down')
        }
      },
      runId
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    throwing.transitionRun('running', 'run_started')
    expect(() => throwing.transitionRun('failed', 'run_failed')).not.toThrow()
    expect(h.db.getWorkflowRun(runId)?.state).toBe('failed')
  })
})
