import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Edge, Workflow } from '../../../shared/workflows/workflow-definition-types'
import { readPath } from './workflow-follow-up-interrupt'
import {
  branchAgent,
  fanOutWorkflow,
  joinDriver,
  joinNode,
  joinWorkflow
} from './workflow-run-controller-join-fixtures'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

function graph(agentIds: string[], edges: Omit<Edge, 'id'>[]): Workflow {
  return {
    ...TWO_NODE_WORKFLOW,
    name: 'failure-settlement',
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      ...agentIds.map((id) => branchAgent(id)),
      { id: 'end', type: 'end', title: 'Done' }
    ],
    edges: edges.map((edge, index) => ({ id: `e${index}`, ...edge }))
  }
}

describe('WorkflowRunController failure settlement (audit N1)', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof joinDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-failure-settlement-'))
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

  it('fails the run and skips End when B fails on Start->A->B->End beside Start->End', async () => {
    const run = h.createRun(
      graph(
        ['a', 'b'],
        [
          { from: 'start', to: 'a' },
          { from: 'a', to: 'b' },
          { from: 'b', to: 'end' },
          { from: 'start', to: 'end' }
        ]
      )
    )
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'a', 'succeeded')
    await d.report(run.id, 'b', 'failed')
    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'end')?.state).toBe('skipped')
  })

  it('fails the run when one of two parallel branches into End fails', async () => {
    const run = h.createRun(
      graph(
        ['a', 'b'],
        [
          { from: 'start', to: 'a' },
          { from: 'start', to: 'b' },
          { from: 'a', to: 'end' },
          { from: 'b', to: 'end' }
        ]
      )
    )
    const finished = h.createController(run.id).run()
    await waitUntil(() => ['a', 'b'].every((id) => d.attempt(run.id, id)?.state === 'running'))
    await d.report(run.id, 'a', 'failed')
    await d.reached(run.id, 'a', ['failed'])
    // A sibling still running keeps End pending rather than skipping it mid-run.
    expect(d.attempt(run.id, 'end')).toBeUndefined()
    await d.report(run.id, 'b', 'succeeded')
    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'end')?.state).toBe('skipped')
  })

  it('fails the run when a node with no path to End fails even though End completed', async () => {
    const run = h.createRun(
      graph(
        ['a'],
        [
          { from: 'start', to: 'a' },
          { from: 'start', to: 'end' }
        ]
      )
    )
    const finished = h.createController(run.id).run()
    await d.reached(run.id, 'end', ['completed'])
    await d.report(run.id, 'a', 'failed')
    await expect(finished).resolves.toBe('failed')
  })

  it('completes when a wait-any Join that skips failures proceeded and a sibling later fails', async () => {
    const run = h.createRun(fanOutWorkflow('any', 'skip'))
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'a', 'succeeded')
    await d.reached(run.id, 'join', ['completed'])
    await d.report(run.id, 'integrate', 'succeeded')
    await d.report(run.id, 'b', 'failed')
    await d.report(run.id, 'c', 'succeeded')
    await expect(finished).resolves.toBe('completed')
  })

  it('completes when a quorum Join that skips failures is met despite a failed branch', async () => {
    const run = h.createRun(fanOutWorkflow({ quorum: 2 }, 'skip'))
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'b', 'failed')
    await d.report(run.id, 'a', 'succeeded')
    await d.report(run.id, 'c', 'succeeded')
    await d.report(run.id, 'integrate', 'succeeded')
    await expect(finished).resolves.toBe('completed')
  })

  // start -> a -> a2 -> join, start -> b -> join; a fails, so a2 is skipped.
  const viaSkippedJoin = (onFailure: 'fail' | 'partial') =>
    joinWorkflow(
      ['a', 'a2', 'b'],
      [
        { id: 'start-a', from: 'start', to: 'a' },
        { id: 'a-a2', from: 'a', to: 'a2' },
        { id: 'a2-join', from: 'a2', to: 'join' },
        { id: 'start-b', from: 'start', to: 'b' },
        { id: 'b-join', from: 'b', to: 'join' }
      ],
      joinNode('all', onFailure)
    )

  it('fails a fail-on-failure Join reached from a failure through a skipped node', async () => {
    const run = h.createRun(viaSkippedJoin('fail'))
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'b', 'succeeded')
    await d.report(run.id, 'a', 'failed')
    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'a2')?.state).toBe('skipped')
    expect(d.attempt(run.id, 'join')).toMatchObject({
      state: 'failed',
      failureReason: 'join_branch_failed'
    })
    expect(d.attempt(run.id, 'integrate')?.state).not.toBe('completed')
    expect(d.attempt(run.id, 'integrate')?.taskId).toBeUndefined()
  })

  it('completes a partial Join reached from a failure through a skipped node', async () => {
    const run = h.createRun(viaSkippedJoin('partial'))
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'b', 'succeeded')
    await d.report(run.id, 'a', 'failed')
    await d.report(run.id, 'integrate', 'succeeded')
    await expect(finished).resolves.toBe('completed')
    expect(d.attempt(run.id, 'join')?.resultJson).toEqual({
      branches: { a2: 'failed', b: 'completed' }
    })
  })

  it('lists only unhandled failures in the run_failed event', async () => {
    const run = h.createRun(fanOutWorkflow('any', 'skip'))
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'a', 'succeeded')
    await d.reached(run.id, 'join', ['completed'])
    await d.report(run.id, 'b', 'failed')
    await d.report(run.id, 'c', 'succeeded')
    await d.report(run.id, 'integrate', 'failed')
    await expect(finished).resolves.toBe('failed')
    const runFailed = h.db.listWorkflowEvents(run.id).find((event) => event.kind === 'run_failed')
    expect(runFailed?.payloadJson).toMatchObject({ reason: 'node_failed' })
    expect(readPath(runFailed?.payloadJson, ['failedNodes'])).toEqual(['integrate'])
  })
})
