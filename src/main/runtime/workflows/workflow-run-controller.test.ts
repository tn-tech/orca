import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { engineCoordinatorHandle } from './workflow-engine-principal'
import { createControllerHarness, waitUntil } from './workflow-run-controller-test-harness'

const SC_002_BUDGET_MS = 5_000

describe('WorkflowRunController', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-controller-'))
    h = createControllerHarness(workspaceRoot)
    // setImmediate stays real so file I/O and the RPC path progress without moving the clock.
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

  function attempt(runId: string, nodeId: string): NodeAttemptView | undefined {
    return h.db.listWorkflowAttempts(runId).find((candidate) => candidate.nodeId === nodeId)
  }

  function requireAttempt(
    runId: string,
    nodeId: string
  ): Required<Pick<NodeAttemptView, 'taskId' | 'dispatchId' | 'resultPath'>> & { id: string } {
    const found = attempt(runId, nodeId)
    if (!found?.taskId || !found.dispatchId || !found.resultPath) {
      throw new Error(`attempt for ${nodeId} is not dispatched`)
    }
    return {
      id: found.id,
      taskId: found.taskId,
      dispatchId: found.dispatchId,
      resultPath: found.resultPath
    }
  }

  async function completeNode(runId: string, nodeId: string, handle: string, result: unknown) {
    const dispatched = requireAttempt(runId, nodeId)
    await h.writeResult(dispatched.resultPath, result)
    const response = await h.sendWorkerDone({
      handle,
      taskId: dispatched.taskId,
      dispatchId: dispatched.dispatchId,
      reportPath: dispatched.resultPath
    })
    expect(response).toMatchObject({ ok: true, result: { lifecycle: { action: 'completed' } } })
    return dispatched
  }

  it('runs start -> implement -> review -> end with just-in-time Tasks and completes', async () => {
    const run = h.createRun()
    const finished = h.createController(run.id).run()

    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    const engineRun = h.db.getRunForWorkflowRun(run.id)
    expect(engineRun).toMatchObject({ coordinator_handle: engineCoordinatorHandle(run.id) })
    expect(h.db.getWorkflowRun(run.id)).toMatchObject({
      state: 'running',
      orchestrationRunId: engineRun?.id
    })
    const implementTasks = h.db.listTasks({ runId: engineRun?.id })
    expect(implementTasks).toHaveLength(1)
    expect(implementTasks[0]).toMatchObject({ workflow_node_id: 'implement', status: 'dispatched' })
    expect(attempt(run.id, 'implement')).toMatchObject({
      requestedLaunch: { agent: 'codex' },
      transcriptRef: { kind: 'dispatch' },
      workspaceWorktreeId: 'repo::run'
    })
    expect(attempt(run.id, 'review')).toBeUndefined()

    const doneAt = Date.now()
    const implement = await completeNode(run.id, 'implement', 'term_worker_1', { summary: 'ok' })
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    expect(h.workerStartedAt[1] - doneAt).toBeLessThan(SC_002_BUDGET_MS)

    expect(h.db.getTask(implement.taskId)?.status).toBe('completed')
    expect(attempt(run.id, 'implement')).toMatchObject({
      state: 'completed',
      resultJson: { summary: 'ok' }
    })
    const reviewTask = h.db.getTask(requireAttempt(run.id, 'review').taskId)
    expect(reviewTask).toMatchObject({ workflow_node_id: 'review', status: 'dispatched' })
    expect(JSON.parse(reviewTask?.deps ?? '[]')).toEqual([implement.taskId])

    await completeNode(run.id, 'review', 'term_worker_2', { verdict: 'approved' })
    await expect(finished).resolves.toBe('completed')

    expect(h.db.getWorkflowRun(run.id)?.state).toBe('completed')
    const states = h.db.listWorkflowAttempts(run.id).map((a) => [a.nodeId, a.state])
    expect(Object.fromEntries(states)).toEqual({
      start: 'completed',
      implement: 'completed',
      review: 'completed',
      end: 'completed'
    })
    expect(states).toHaveLength(4)
    const kinds = h.db.listWorkflowEvents(run.id).map((event) => event.kind)
    expect(kinds[0]).toBe('run_started')
    expect(kinds).toContain('worker_done_received')
    expect(kinds.at(-1)).toBe('run_completed')
    expect(h.notifyWorkflowRunChanged).toHaveBeenCalledWith({ runId: run.id, reason: 'attempt' })
    expect(h.notifyWorkflowRunChanged).toHaveBeenLastCalledWith({ runId: run.id, reason: 'state' })
  })

  it('fails a node whose result breaks its contract, skips its successors and fails the run', async () => {
    const run = h.createRun()
    const finished = h.createController(run.id).run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')

    const implement = await completeNode(run.id, 'implement', 'term_worker_1', { wrong: 1 })
    await expect(finished).resolves.toBe('failed')

    expect(attempt(run.id, 'implement')).toMatchObject({
      state: 'failed',
      failureReason: 'result_invalid'
    })
    expect(h.db.getTask(implement.taskId)?.status).toBe('failed')
    expect(attempt(run.id, 'review')?.state).toBe('skipped')
    expect(attempt(run.id, 'end')?.state).toBe('skipped')
    const failure = h.db
      .listWorkflowEvents(run.id)
      .find((event) => event.kind === 'attempt_failed' && event.attemptId === implement.id)
    expect(failure?.payloadJson).toMatchObject({ failureReason: 'result_invalid' })
    expect(h.workerHandles).toHaveLength(1)
  })

  it('logs and ignores Run mail that no Dispatch of this run sent', async () => {
    const run = h.createRun()
    const controller = h.createController(run.id)
    const finished = controller.run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    const engineRunId = h.db.getRunForWorkflowRun(run.id)?.id

    const stranger = h.db.insertMessage({
      from: 'term_stranger',
      to: `run:${engineRunId}`,
      subject: 'hello',
      body: 'not yours',
      type: 'status',
      runId: engineRunId
    })
    h.runtime.notifyMessageArrived(stranger.to_handle, stranger.type)
    await waitUntil(() =>
      h.db.listWorkflowEvents(run.id).some((event) => event.kind === 'mailbox_message_ignored')
    )

    expect(attempt(run.id, 'implement')?.state).toBe('running')
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('running')
    controller.stop()
    await expect(finished).resolves.toBe('running')
  })

  it('rehydrates after a restart and consumes worker_done left in the mailbox backlog', async () => {
    const run = h.createRun()
    const first = h.createController(run.id)
    const firstFinished = first.run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    first.stop()
    await expect(firstFinished).resolves.toBe('running')

    await completeNode(run.id, 'implement', 'term_worker_1', { summary: 'while down' })
    expect(attempt(run.id, 'implement')?.state).toBe('running')

    const second = h.createController(run.id)
    const secondFinished = second.run()
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    expect(attempt(run.id, 'implement')?.state).toBe('completed')
    expect(h.workerHandles).toEqual(['term_worker_1', 'term_worker_2'])
    second.stop()
    await expect(secondFinished).resolves.toBe('running')
  })
})
