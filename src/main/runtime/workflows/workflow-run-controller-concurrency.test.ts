// FR-031: the run's per-run concurrency limit gates how many fan-out branches dispatch a worker
// at once; a queued branch has no attempt until a slot frees, including across a restart.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fanOutWorkflow, joinDriver } from './workflow-run-controller-join-fixtures'
import {
  createControllerHarness,
  RUN_WORKTREE_ID,
  waitUntil
} from './workflow-run-controller-test-harness'

describe('WorkflowRunController concurrency', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof joinDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-controller-concurrency-'))
    h = createControllerHarness(workspaceRoot)
    d = joinDriver(h)
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

  /** start -> a|b|c -> join -> integrate -> end, three branches under a tight limit. */
  function createRun(concurrencyLimit: number) {
    const workflow = fanOutWorkflow('all', 'fail')
    return h.db.createWorkflowRun({
      workflowName: workflow.name,
      workflowSource: 'project',
      workflowSnapshot: workflow,
      workflowVersion: 'v1',
      objective: 'fan out under a tight concurrency limit',
      repoId: 'repo',
      worktreeId: RUN_WORKTREE_ID,
      concurrencyLimit
    })
  }

  async function bothRunning(runId: string): Promise<void> {
    await waitUntil(
      () => d.attempt(runId, 'a')?.state === 'running' && d.attempt(runId, 'b')?.state === 'running'
    )
  }

  it('holds the third branch queued until a running one frees a slot (US3 AS1)', async () => {
    const run = createRun(2)
    const finished = h.createController(run.id).run()

    await bothRunning(run.id)
    expect(h.workerHandles).toHaveLength(2)
    expect(d.attempt(run.id, 'c')).toBeUndefined()

    await d.report(run.id, 'a', 'succeeded')
    await waitUntil(() => d.attempt(run.id, 'c')?.state === 'running')
    expect(h.workerHandles).toHaveLength(3)

    await d.report(run.id, 'b', 'succeeded')
    await d.report(run.id, 'c', 'succeeded')
    await d.report(run.id, 'integrate', 'succeeded')
    await expect(finished).resolves.toBe('completed')

    const nodeIds = h.db.listWorkflowAttempts(run.id).map((a) => a.nodeId)
    expect(nodeIds).toHaveLength(7)
    expect(new Set(nodeIds).size).toBe(nodeIds.length)
  })

  it('recounts running attempts on rehydrate, so the queued branch is not lost across a restart', async () => {
    const run = createRun(2)
    const first = h.createController(run.id)
    const firstFinished = first.run()
    await bothRunning(run.id)
    expect(d.attempt(run.id, 'c')).toBeUndefined()
    first.stop()
    await expect(firstFinished).resolves.toBe('running')

    const second = h.createController(run.id)
    const secondFinished = second.run()
    // Rehydrate recounts a and b as still running from the DB, so the budget stays exhausted.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(d.attempt(run.id, 'c')).toBeUndefined()

    await d.report(run.id, 'a', 'succeeded')
    await waitUntil(() => d.attempt(run.id, 'c')?.state === 'running')
    await d.report(run.id, 'b', 'succeeded')
    await d.report(run.id, 'c', 'succeeded')
    await d.report(run.id, 'integrate', 'succeeded')
    await expect(secondFinished).resolves.toBe('completed')
  })

  it('lets every branch start at once when the limit is not exceeded (default 4)', async () => {
    const run = createRun(4)
    const finished = h.createController(run.id).run()

    await waitUntil(() =>
      ['a', 'b', 'c'].every((nodeId) => d.attempt(run.id, nodeId)?.state === 'running')
    )
    expect(h.workerHandles).toHaveLength(3)

    await d.report(run.id, 'a', 'succeeded')
    await d.report(run.id, 'b', 'succeeded')
    await d.report(run.id, 'c', 'succeeded')
    await d.report(run.id, 'integrate', 'succeeded')
    await expect(finished).resolves.toBe('completed')
  })
})
