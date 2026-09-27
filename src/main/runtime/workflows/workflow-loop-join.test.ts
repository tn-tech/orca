import { describe, expect, it } from 'vitest'
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { Edge, Node } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../shared/workflows/workflow-node-states'
import { agent, end, nestedLoop, start, workflow } from './workflow-frontier-test-fixtures'
import { computeLoopProgress, type LoopProgressAttempt } from './workflow-loop-unrolling'

const join = (id: string): Node => ({
  id,
  type: 'join',
  title: id,
  policy: 'all',
  onFailure: 'fail'
})
// The engine never runs a Loop nested in a body, so it stands in for a branch that never settles.
const gate: Node = nestedLoop('gate')

/** start -> qa{ entry a ... exit e } -> end; `e` completes on its own path from `a`. */
function loopWith(bodyNodes: Node[], bodyEdges: Edge[]) {
  const ids = ['a', ...bodyNodes.map((node) => node.id), 'e']
  return workflow(
    [
      start,
      {
        id: 'qa',
        type: 'loop',
        title: 'QA',
        body: { nodeIds: ids },
        entryNodeId: 'a',
        exitNodeId: 'e',
        maxIterations: 2,
        exitCondition: { path: 'approved', op: 'eq', value: true },
        onCapReached: 'fail'
      },
      agent('a'),
      ...bodyNodes,
      agent('e'),
      end
    ],
    [
      { id: 'in', from: 'start', to: 'qa' },
      { id: 'a-e', from: 'a', to: 'e' },
      ...bodyEdges,
      { id: 'out', from: 'qa', to: 'end', fromPort: 'exit' }
    ]
  )
}

function at(
  nodeId: string,
  state: WorkflowAttemptState,
  extra: { resultJson?: JsonValue; failureReason?: string } = {}
): LoopProgressAttempt {
  return { id: `${nodeId}#0`, nodeId, iteration: 0, attemptIndex: 0, state, ...extra }
}

const running = [at('start', 'completed'), at('qa', 'running'), at('a', 'completed')]
const outcome = (def: ReturnType<typeof loopWith>, attempts: LoopProgressAttempt[]) =>
  computeLoopProgress(def, attempts).settlements.map((settlement) => settlement.outcome)

describe('Loop settlement with a Join in the body', () => {
  // a -(go)-> x -> j; a -(go)-> y -> j
  const go = { path: 'go', op: 'eq', value: true } as const
  const skippedJoin = loopWith(
    [agent('x'), agent('y'), join('j')],
    [
      { id: 'a-x', from: 'a', to: 'x', condition: go },
      { id: 'a-y', from: 'a', to: 'y', condition: go },
      { id: 'x-j', from: 'x', to: 'j' },
      { id: 'y-j', from: 'y', to: 'j' }
    ]
  )
  const branchesSkipped = [...running, at('x', 'skipped'), at('y', 'skipped')]

  it('evaluates the exit condition past a Join cancelled because all its branches were skipped', () => {
    const joinSkipped = at('j', 'cancelled', { failureReason: 'join_skipped' })
    const exited = at('e', 'completed', { resultJson: { approved: true } })
    expect(outcome(skippedJoin, [...branchesSkipped, joinSkipped, exited])).toEqual(['exited'])
    const rejected = at('e', 'completed', { resultJson: { approved: false } })
    expect(
      computeLoopProgress(skippedJoin, [...branchesSkipped, joinSkipped, rejected]).eligible
    ).toEqual([{ nodeId: 'a', iteration: 1 }])
    // Any other cancelled body attempt is still a body failure.
    expect(outcome(skippedJoin, [...branchesSkipped, at('j', 'cancelled'), exited])).toEqual([
      'body_failed'
    ])
  })

  // a -> j <- gate(nested loop): the unrun nested Loop leaves j Waiting forever.
  const stuckSideJoin = loopWith(
    [gate, join('j')],
    [
      { id: 'a-j', from: 'a', to: 'j' },
      { id: 'a-gate', from: 'a', to: 'gate' },
      { id: 'gate-j', from: 'gate', to: 'j' }
    ]
  )
  const joinWaiting = [...running, at('j', 'waiting')]

  it('waits while the exit path is still running beside a stuck side Join', () => {
    expect(outcome(stuckSideJoin, [...joinWaiting, at('e', 'running')])).toEqual([])
  })

  it('evaluates the exit condition when the exit completed beside a stuck side Join', () => {
    const exited = at('e', 'completed', { resultJson: { approved: true } })
    expect(outcome(stuckSideJoin, [...joinWaiting, exited])).toEqual(['exited'])
    const rejected = at('e', 'completed', { resultJson: { approved: false } })
    expect(computeLoopProgress(stuckSideJoin, [...joinWaiting, rejected]).eligible).toEqual([
      { nodeId: 'a', iteration: 1 }
    ])
  })

  it('settles exit_unreached when the exit never completes beside a stuck side Join', () => {
    expect(outcome(stuckSideJoin, [...joinWaiting, at('e', 'skipped')])).toEqual(['exit_unreached'])
  })
})
