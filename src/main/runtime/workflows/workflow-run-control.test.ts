import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { approvalDriver, approvalWorkflow } from './workflow-approval-test-fixtures'
import { queueFollowUp } from './workflow-follow-up-delivery'
import { answerRunQuestion } from './workflow-question-answer'
import { fanOutWorkflow, joinDriver } from './workflow-run-controller-join-fixtures'
import { createControllerHarness, waitUntil } from './workflow-run-controller-test-harness'
import { cancelWorkflowRun, pauseWorkflowRun, resumeWorkflowRun } from './workflow-run-control'

describe('workflow run control (pause / resume / cancel)', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof approvalDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-control-'))
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

  const kinds = (runId: string) => h.db.listWorkflowEvents(runId).map((event) => event.kind)
  const runState = (runId: string) => h.db.getWorkflowRun(runId)?.state

  /** Lets the controller drain whatever it would do next, without a condition to wait for. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  function start(workflow = h.createRun()) {
    const controller = h.createController(workflow.id)
    return { run: workflow, controller, finished: controller.run() }
  }

  function stopDeps(finished?: Promise<unknown>) {
    return {
      db: h.db,
      runtime: h.runtime,
      dispatcher: h.dispatcher,
      whenControllerSettled: async () => {
        await finished
      }
    }
  }

  it('pause stops new dispatches while the running attempt finishes; resume continues', async () => {
    const { run, finished } = start()
    await d.reached(run.id, 'implement', 'running')

    expect(pauseWorkflowRun(h.db, h.runtime, run.id)).toBe('paused')
    await d.report(run.id, 'implement', { summary: 'done while paused' })
    await d.reached(run.id, 'implement', 'completed')
    await settle()
    expect(d.attempt(run.id, 'review')).toBeUndefined()
    expect(h.workerHandles).toHaveLength(1)
    expect(runState(run.id)).toBe('paused')

    expect(resumeWorkflowRun(h.db, h.runtime, run.id)).toBe('running')
    await d.report(run.id, 'review', { verdict: 'approved' })
    await expect(finished).resolves.toBe('completed')
    expect(kinds(run.id)).toEqual(expect.arrayContaining(['run_paused', 'run_resumed']))
  })

  it('keeps a pending approval answerable while paused and resumes into waiting while one is open', async () => {
    const { run, controller, finished } = start(
      h.createRun(approvalWorkflow(undefined, { withSideBranch: false }))
    )
    await d.reached(run.id, 'gate', 'waiting')
    expect(runState(run.id)).toBe('waiting')

    expect(pauseWorkflowRun(h.db, h.runtime, run.id)).toBe('paused')
    expect(resumeWorkflowRun(h.db, h.runtime, run.id)).toBe('waiting')
    expect(pauseWorkflowRun(h.db, h.runtime, run.id)).toBe('paused')

    const question = d.question(run.id)
    expect(question?.state).toBe('pending')
    answerRunQuestion(h.db, h.runtime, {
      runId: run.id,
      questionId: question?.id ?? '',
      optionId: 'approve',
      answeredBy: 'user_1'
    })
    await d.reached(run.id, 'gate', 'completed')
    await settle()
    expect(d.attempt(run.id, 'a')).toBeUndefined()
    expect(runState(run.id)).toBe('paused')

    expect(resumeWorkflowRun(h.db, h.runtime, run.id)).toBe('running')
    await d.reached(run.id, 'a', 'running')
    controller.stop()
    await finished
  })

  it('an unrouted approval answer while paused still stops the run as failed', async () => {
    const { run, finished } = start(
      h.createRun(approvalWorkflow(undefined, { withRejectEdge: false, withSideBranch: false }))
    )
    await d.reached(run.id, 'gate', 'waiting')
    expect(pauseWorkflowRun(h.db, h.runtime, run.id)).toBe('paused')

    answerRunQuestion(h.db, h.runtime, {
      runId: run.id,
      questionId: d.question(run.id)?.id ?? '',
      optionId: 'reject',
      answeredBy: 'user_1'
    })

    await expect(finished).resolves.toBe('failed')
    const failed = h.db.listWorkflowEvents(run.id).find((event) => event.kind === 'run_failed')
    expect(failed?.payloadJson).toMatchObject({ reason: 'approval_rejected' })
    expect(d.attempt(run.id, 'a')).toBeUndefined()
  })

  it('a controller rehydrated on a paused run dispatches nothing until resumed', async () => {
    const run = h.createRun()
    const first = h.createController(run.id)
    const firstDone = first.run()
    await d.reached(run.id, 'implement', 'running')
    pauseWorkflowRun(h.db, h.runtime, run.id)
    first.stop()
    await expect(firstDone).resolves.toBe('paused')

    await d.report(run.id, 'implement', { summary: 'while down' })
    const second = h.createController(run.id)
    const secondDone = second.run()
    await d.reached(run.id, 'implement', 'completed')
    await settle()
    expect(d.attempt(run.id, 'review')).toBeUndefined()

    resumeWorkflowRun(h.db, h.runtime, run.id)
    await d.report(run.id, 'review', { verdict: 'ok' })
    await expect(secondDone).resolves.toBe('completed')
  })

  it('cancel asks every live worker to stop, cancels only proven stops and marks the run cancelled', async () => {
    let runId = ''
    const stops = joinDriver(h).interceptWorkerStop((dispatchId) =>
      dispatchId === d.attempt(runId, 'c')?.dispatchId
        ? { state: 'running', lastError: 'no terminal' }
        : { state: 'stopped', alreadySettled: false }
    )
    const attention = vi.fn()
    Object.assign(h.runtime, { notifyWorkflowAttention: attention })
    const { run, finished } = start(h.createRun(fanOutWorkflow('all', 'fail')))
    runId = run.id
    await waitUntil(() => ['a', 'b', 'c'].every((id) => d.attempt(run.id, id)?.state === 'running'))

    await expect(cancelWorkflowRun(stopDeps(finished), run.id)).resolves.toBe('cancelled')

    await expect(finished).resolves.toBe('cancelled')
    expect(stops).toHaveLength(3)
    expect(d.attempt(run.id, 'a')?.state).toBe('cancelled')
    expect(d.attempt(run.id, 'b')?.state).toBe('cancelled')
    // Unconfirmed: never recorded as stopped, left as the host last reported it.
    expect(d.attempt(run.id, 'c')?.state).toBe('running')
    const unconfirmed = h.db
      .listWorkflowEvents(run.id)
      .find((event) => event.kind === 'run_cancel_stop_unconfirmed')
    expect(unconfirmed?.payloadJson).toMatchObject({ nodeId: 'c', state: 'running' })
    expect(runState(run.id)).toBe('cancelled')
    expect(kinds(run.id)).toContain('run_cancelled')
    expect(d.attempt(run.id, 'join')).toBeUndefined()
    expect(h.workerHandles).toHaveLength(3)
    expect(attention).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'run-failed' }))
  })

  it('cancel closes open questions so nothing is left answerable', async () => {
    joinDriver(h).interceptWorkerStop(() => ({ state: 'stopped', alreadySettled: false }))
    const { run, finished } = start(h.createRun(approvalWorkflow()))
    await d.reached(run.id, 'gate', 'waiting')
    await d.reached(run.id, 'side', 'running')
    const question = d.question(run.id)

    await cancelWorkflowRun(stopDeps(finished), run.id)

    expect(h.db.listOpenWorkflowQuestions(run.id)).toEqual([])
    expect(d.attempt(run.id, 'gate')?.state).toBe('cancelled')
    expect(d.attempt(run.id, 'side')?.state).toBe('cancelled')
    expect(() =>
      answerRunQuestion(h.db, h.runtime, {
        runId: run.id,
        questionId: question?.id ?? '',
        optionId: 'approve',
        answeredBy: 'user_1'
      })
    ).toThrow()
  })

  it('cancels a paused run with no live controller and settles its queued follow-ups', async () => {
    joinDriver(h).interceptWorkerStop(() => ({ state: 'stopped', alreadySettled: false }))
    const { run, controller, finished } = start()
    await d.reached(run.id, 'implement', 'running')
    pauseWorkflowRun(h.db, h.runtime, run.id)
    controller.stop()
    await finished
    const message = queueFollowUp(h.db, h.runtime, {
      runId: run.id,
      attemptId: d.attempt(run.id, 'implement')?.id ?? '',
      text: 'also add tests',
      mode: 'queued',
      sender: 'user_1'
    })

    await expect(cancelWorkflowRun(stopDeps(), run.id)).resolves.toBe('cancelled')

    expect(d.attempt(run.id, 'implement')?.state).toBe('cancelled')
    expect(h.db.listWorkflowMessages(run.id).find((m) => m.id === message.id)?.state).toBe('failed')
  })

  it('is idempotent for a cancelled run and refuses to cancel a finished one', async () => {
    const cancelled = h.createRun()
    await cancelWorkflowRun(stopDeps(), cancelled.id)
    await expect(cancelWorkflowRun(stopDeps(), cancelled.id)).resolves.toBe('cancelled')

    const done = h.createRun()
    h.db.transitionWorkflowRun(done.id, 'running')
    h.db.transitionWorkflowRun(done.id, 'completed')
    await expect(cancelWorkflowRun(stopDeps(), done.id)).rejects.toMatchObject({
      code: 'workflow_run_transition_invalid'
    })
    expect(() => pauseWorkflowRun(h.db, h.runtime, done.id)).toThrow(
      expect.objectContaining({ code: 'workflow_run_transition_invalid' })
    )
  })
})
