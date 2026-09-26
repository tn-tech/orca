import { describe, expect, it } from 'vitest'
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { agent, attempt, end, start, workflow } from './workflow-frontier-test-fixtures'
import { joinBranchesInput } from './workflow-join-settlement'

function view(nodeId: string, state: NodeAttemptView['state'], branches: JsonValue) {
  return {
    ...attempt(nodeId, state, { resultJson: { branches } }),
    id: `att_${nodeId}`,
    runId: 'run',
    nodeType: nodeId === 'join' ? ('join' as const) : ('agent' as const),
    artifactsJson: []
  }
}

// Loop body: a|b -> join -> a (back-edge); join -> review
const def = workflow(
  [
    start,
    agent('a'),
    agent('b'),
    { id: 'join', type: 'join', title: 'Join', policy: 'all', onFailure: 'partial' },
    agent('review'),
    end
  ],
  [
    { id: 'e1', from: 'a', to: 'join' },
    { id: 'e2', from: 'b', to: 'join' },
    { id: 'e3', from: 'join', to: 'a', fromPort: 'body' },
    { id: 'e4', from: 'join', to: 'review' }
  ]
)

describe('joinBranchesInput', () => {
  const attempts = [view('join', 'completed', { a: 'completed', b: 'failed' })]

  it('gives a direct successor the completed Join branches', () => {
    expect(joinBranchesInput(def, attempts, 'review')).toEqual({ a: 'completed', b: 'failed' })
  })

  it('ignores Loop back-edges from a Join', () => {
    expect(joinBranchesInput(def, attempts, 'a')).toBeUndefined()
  })
})
