import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fanOutWorkflow,
  joinDriver,
  joinNode,
  joinWorkflow
} from './workflow-run-controller-join-fixtures'
import { createControllerHarness, waitUntil } from './workflow-run-controller-test-harness'

describe('WorkflowRunController stopping a failed Join branches', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof joinDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-controller-join-stop-'))
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

  const events = (runId: string, kind: string) =>
    h.db.listWorkflowEvents(runId).filter((event) => event.kind === kind)

  it('fails a fail-on-any Join on the first failure and stops the running siblings', async () => {
    let runId = ''
    // The worker for `a` is proven stopped; the one for `c` cannot be confirmed.
    const stops = d.interceptWorkerStop((dispatchId) =>
      dispatchId === d.attempt(runId, 'a')?.dispatchId
        ? { state: 'stopped', alreadySettled: false }
        : { state: 'running', lastError: 'no terminal' }
    )
    const run = h.createRun(fanOutWorkflow('all', 'fail'))
    runId = run.id
    const finished = h.createController(run.id).run()
    await waitUntil(() => ['a', 'b', 'c'].every((id) => d.attempt(run.id, id)?.state === 'running'))

    await d.report(run.id, 'b', 'failed')
    await d.reached(run.id, 'join', ['failed'])
    expect(d.attempt(run.id, 'join')).toMatchObject({
      failureReason: 'join_branch_failed',
      resultJson: { branches: { a: 'pending', b: 'failed', c: 'pending' } }
    })
    expect(stops.sort()).toEqual(
      [d.attempt(run.id, 'a')?.dispatchId, d.attempt(run.id, 'c')?.dispatchId].sort()
    )
    expect(d.attempt(run.id, 'a')?.state).toBe('cancelled')
    expect(d.attempt(run.id, 'c')?.state).toBe('running')
    expect(events(run.id, 'join_branch_stop_unconfirmed')[0]?.payloadJson).toMatchObject({
      joinNodeId: 'join',
      nodeId: 'c',
      state: 'running',
      lastError: 'no terminal'
    })
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('running')

    // The unconfirmed sibling still reports in; only then is the run quiet and failed.
    await d.report(run.id, 'c', 'succeeded')
    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'integrate')?.state).toBe('skipped')
  })

  it('never launches the unstarted rest of a branch once the Join failed', async () => {
    const stops = d.interceptWorkerStop(() => ({ state: 'stopped', alreadySettled: false }))
    // start -> a -> join; start -> b1 -> b2 -> join
    const run = h.createRun(
      joinWorkflow(
        ['a', 'b1', 'b2'],
        [
          { id: 'e1', from: 'start', to: 'a' },
          { id: 'e2', from: 'start', to: 'b1' },
          { id: 'e3', from: 'b1', to: 'b2' },
          { id: 'e4', from: 'a', to: 'join' },
          { id: 'e5', from: 'b2', to: 'join' }
        ],
        joinNode('all', 'fail')
      )
    )
    const finished = h.createController(run.id).run()
    await waitUntil(() => d.attempt(run.id, 'b1')?.state === 'running')
    await d.report(run.id, 'a', 'failed')
    await expect(finished).resolves.toBe('failed')

    expect(stops).toEqual([d.attempt(run.id, 'b1')?.dispatchId])
    expect(d.attempt(run.id, 'b1')?.state).toBe('cancelled')
    expect(d.attempt(run.id, 'b2')?.state).toBe('skipped')
    expect(events(run.id, 'attempt_skipped').map((e) => e.payloadJson)).toContainEqual(
      expect.objectContaining({ nodeId: 'b2', reason: 'join_failed', joinNodeId: 'join' })
    )
    expect(h.workerHandles).toHaveLength(2)
  })

  it('stops the remaining branches when a quorum becomes unreachable under fail', async () => {
    const stops = d.interceptWorkerStop(() => ({ state: 'stopped', alreadySettled: false }))
    // start -> a -(go)-> x -> join; start -> b -> join; start -> c1 -> c2 -> join; quorum 3
    const run = h.createRun(
      joinWorkflow(
        ['a', 'x', 'b', 'c1', 'c2'],
        [
          { id: 'e1', from: 'start', to: 'a' },
          { id: 'e2', from: 'a', to: 'x', condition: { path: 'go', op: 'eq', value: true } },
          { id: 'e3', from: 'start', to: 'b' },
          { id: 'e4', from: 'start', to: 'c1' },
          { id: 'e5', from: 'c1', to: 'c2' },
          { id: 'e6', from: 'x', to: 'join' },
          { id: 'e7', from: 'b', to: 'join' },
          { id: 'e8', from: 'c2', to: 'join' }
        ],
        joinNode({ quorum: 3 }, 'fail')
      )
    )
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'b', 'succeeded')
    await d.reached(run.id, 'join', ['waiting'])
    await d.report(run.id, 'a', 'succeeded', { go: false })
    await expect(finished).resolves.toBe('failed')

    expect(d.attempt(run.id, 'join')).toMatchObject({
      state: 'failed',
      failureReason: 'join_unsatisfied',
      resultJson: { branches: { x: 'skipped', b: 'completed', c2: 'pending' } }
    })
    expect(stops).toEqual([d.attempt(run.id, 'c1')?.dispatchId])
    expect(d.attempt(run.id, 'c1')?.state).toBe('cancelled')
    expect(d.attempt(run.id, 'c2')?.state).toBe('skipped')
  })
})
