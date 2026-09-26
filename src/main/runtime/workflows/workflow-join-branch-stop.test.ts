import { describe, expect, it } from 'vitest'
import type { Node } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { incomingBranches, latestAttemptByNode } from './workflow-frontier'
import { agent, attempt, end, start, workflow } from './workflow-frontier-test-fixtures'
import { remainingBranchNodes } from './workflow-join-branch-stop'

const join: Node & { type: 'join' } = {
  id: 'join',
  type: 'join',
  title: 'Join',
  policy: 'all',
  onFailure: 'fail'
}

// start -> a -> join; start -> b1 -> b2 -> join; start -> c -> join
const def = workflow(
  [start, agent('a'), agent('b1'), agent('b2'), agent('c'), join, end],
  [
    { id: 'e1', from: 'start', to: 'a' },
    { id: 'e2', from: 'start', to: 'b1' },
    { id: 'e3', from: 'b1', to: 'b2' },
    { id: 'e4', from: 'start', to: 'c' },
    { id: 'e5', from: 'a', to: 'join' },
    { id: 'e6', from: 'b2', to: 'join' },
    { id: 'e7', from: 'c', to: 'join' },
    { id: 'e8', from: 'join', to: 'end' }
  ]
)

function view(nodeId: string, state: NodeAttemptView['state']): NodeAttemptView {
  return {
    ...attempt(nodeId, state),
    id: `att_${nodeId}`,
    runId: 'run',
    nodeType: 'agent',
    artifactsJson: []
  }
}

describe('remainingBranchNodes', () => {
  it('collects unstarted nodes and running attempts on the Join pending branches only', () => {
    const attempts = [
      view('start', 'completed'),
      view('a', 'failed'),
      view('b1', 'running'),
      view('c', 'running')
    ]
    const incoming = incomingBranches(def, latestAttemptByNode(attempts), 'join')
    const remaining = remainingBranchNodes(def, attempts, join, 0, incoming)
    expect(remaining.unstarted).toEqual(['b2'])
    expect(remaining.active.map((a) => a.nodeId).sort()).toEqual(['b1', 'c'])
  })
})
