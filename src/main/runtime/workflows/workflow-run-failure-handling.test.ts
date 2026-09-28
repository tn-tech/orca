import { describe, expect, it } from 'vitest'
import type { JoinNode } from '../../../shared/workflows/workflow-definition-types'
import { agent, attempt, end, start, workflow } from './workflow-frontier-test-fixtures'
import { unhandledFailedNodeIds } from './workflow-run-failure-handling'

const join = (onFailure: JoinNode['onFailure']): JoinNode => ({
  id: 'join',
  type: 'join',
  title: 'Join',
  policy: 'any',
  onFailure
})

// start -> a -> b -> join -> end, start -> c -> join
const viaSkipped = (onFailure: JoinNode['onFailure']) =>
  workflow(
    [start, agent('a'), agent('b'), agent('c'), join(onFailure), end],
    [
      { id: 'e1', from: 'start', to: 'a' },
      { id: 'e2', from: 'a', to: 'b' },
      { id: 'e3', from: 'b', to: 'join' },
      { id: 'e4', from: 'start', to: 'c' },
      { id: 'e5', from: 'c', to: 'join' },
      { id: 'e6', from: 'join', to: 'end' }
    ]
  )

const settled = [
  attempt('start', 'completed'),
  attempt('a', 'failed'),
  attempt('b', 'skipped'),
  attempt('c', 'completed'),
  attempt('join', 'completed'),
  attempt('end', 'completed')
]

describe('unhandledFailedNodeIds', () => {
  it('reports a failed node with no outgoing edge', () => {
    const def = workflow(
      [start, agent('a'), end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'end' }
      ]
    )
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'failed'),
      attempt('end', 'completed')
    ]
    expect(unhandledFailedNodeIds(def, attempts)).toEqual(['a'])
  })

  it('treats a failure reaching a completed tolerant Join through skipped nodes as handled', () => {
    expect(unhandledFailedNodeIds(viaSkipped('skip'), settled)).toEqual([])
    expect(unhandledFailedNodeIds(viaSkipped('partial'), settled)).toEqual([])
  })

  it('never lets a fail-on-failure Join absorb a failure', () => {
    expect(unhandledFailedNodeIds(viaSkipped('fail'), settled)).toEqual(['a'])
  })

  it('ignores a failed attempt a later attempt of the same node superseded', () => {
    const def = workflow(
      [start, agent('a'), end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'a', to: 'end' }
      ]
    )
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'failed', { attemptIndex: 0 }),
      attempt('a', 'completed', { attemptIndex: 1 }),
      attempt('end', 'completed')
    ]
    expect(unhandledFailedNodeIds(def, attempts)).toEqual([])
  })
})
