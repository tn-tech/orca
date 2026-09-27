import { describe, expect, it, vi } from 'vitest'
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { Edge, LoopNode, Node } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../shared/workflows/workflow-node-states'
import { computeFrontier } from './workflow-frontier'
import { createNodeTask } from './workflow-frontier-node-task'
import { agent, end, nestedLoop, start, workflow } from './workflow-frontier-test-fixtures'
import { computeLoopProgress, type LoopProgressAttempt } from './workflow-loop-unrolling'

function loop(bodyNodeIds: string[]): LoopNode {
  return {
    id: 'qa',
    type: 'loop',
    title: 'QA loop',
    body: { nodeIds: bodyNodeIds },
    entryNodeId: 'implement',
    exitNodeId: 'review',
    maxIterations: 3,
    exitCondition: { path: 'approved', op: 'eq', value: true },
    onCapReached: 'fail'
  }
}

// The engine never runs a Loop nested in a body, so nothing is ever offered past it.
const gate: Node = nestedLoop('route')

function at(
  nodeId: string,
  state: WorkflowAttemptState,
  extra: { iteration?: number; resultJson?: JsonValue; taskId?: string } = {}
): LoopProgressAttempt {
  return {
    id: `${nodeId}#${extra.iteration ?? 0}`,
    attemptIndex: 0,
    iteration: 0,
    nodeId,
    state,
    ...extra
  }
}

const started = [at('start', 'completed'), at('qa', 'running')]
const entry: Edge = { id: 'in', from: 'start', to: 'qa' }
const exitEdge: Edge = { id: 'out', from: 'qa', to: 'end', fromPort: 'exit' }

describe('Loop exit resolution', () => {
  it('never launches body node types the engine cannot run, and settles once the exit is unreachable', () => {
    const def = workflow(
      [
        start,
        loop(['implement', 'route', 'review']),
        agent('implement'),
        gate,
        agent('review'),
        end
      ],
      [
        entry,
        { id: 'a', from: 'implement', to: 'route' },
        { id: 'b', from: 'route', to: 'review' },
        exitEdge
      ]
    )
    const progress = computeLoopProgress(def, [...started, at('implement', 'completed')])
    expect(progress.eligible).toEqual([])
    expect(progress.settlements).toEqual([
      {
        loopId: 'qa',
        attemptId: 'qa#0',
        outcome: 'exit_unreached',
        iterations: 1,
        exitResult: null
      }
    ])
  })

  it('fails with exit_unreached when an in-body condition skips the exit node', () => {
    const def = workflow(
      [start, loop(['implement', 'review']), agent('implement'), agent('review'), end],
      [
        entry,
        { id: 'a', from: 'implement', to: 'review', condition: { path: 'ok', op: 'truthy' } },
        exitEdge
      ]
    )
    const done = [...started, at('implement', 'completed', { resultJson: { ok: false } })]
    expect(computeLoopProgress(def, done).skipped).toEqual([{ nodeId: 'review', iteration: 0 }])
    expect(computeLoopProgress(def, [...done, at('review', 'skipped')]).settlements).toMatchObject([
      { outcome: 'exit_unreached' }
    ])
  })

  it('waits while the exit node depends on an outside node that can still settle', () => {
    const def = workflow(
      [start, loop(['implement', 'review']), agent('implement'), agent('review'), agent('x'), end],
      [
        entry,
        { id: 'sx', from: 'start', to: 'x' },
        { id: 'a', from: 'implement', to: 'review' },
        { id: 'b', from: 'x', to: 'review' },
        exitEdge
      ]
    )
    const waiting = [...started, at('implement', 'completed'), at('x', 'running')]
    expect(computeLoopProgress(def, waiting)).toEqual({
      eligible: [],
      skipped: [],
      iterationStarts: [],
      settlements: []
    })
    const resolved = [...started, at('implement', 'completed'), at('x', 'completed')]
    expect(computeLoopProgress(def, resolved).eligible).toEqual([
      { nodeId: 'review', iteration: 0 }
    ])
  })

  it('settles when that outside node never gets an attempt and nothing else is moving', () => {
    const def = workflow(
      [
        start,
        loop(['implement', 'review']),
        agent('implement'),
        agent('review'),
        agent('route'),
        end
      ],
      [
        entry,
        { id: 'a', from: 'implement', to: 'review' },
        { id: 'b', from: 'route', to: 'review' },
        exitEdge
      ]
    )
    expect(
      computeLoopProgress(def, [...started, at('implement', 'completed')]).settlements
    ).toMatchObject([{ outcome: 'exit_unreached' }])
  })

  it('fires an exit edge drawn from a body node only when the Loop settles', async () => {
    const def = workflow(
      [start, loop(['implement', 'review']), agent('implement'), agent('review'), end],
      [
        entry,
        { id: 'a', from: 'implement', to: 'review' },
        { id: 'out', from: 'review', to: 'end', fromPort: 'exit' }
      ]
    )
    const reviewed = [
      ...started,
      at('implement', 'completed'),
      at('review', 'completed', { resultJson: { approved: false }, taskId: 'task_review' })
    ]
    expect(computeFrontier(def, reviewed).eligible).toEqual([])
    const exited = reviewed.map((a) =>
      a.nodeId === 'qa' ? { ...a, state: 'completed' as const } : a
    )
    expect(computeFrontier(def, exited).eligible).toEqual(['end'])

    const call = vi.fn(async () => ({ task: { id: 'task_end' } }))
    await createNodeTask(
      { call },
      { definition: def, attempts: exited, nodeId: 'end', iteration: 0, spec: 's' }
    )
    // The exit edge resolves through the Loop, which has no Task of its own.
    expect(call).toHaveBeenCalledWith(
      'orchestration.taskCreate',
      expect.objectContaining({ deps: '[]' })
    )
  })
})
