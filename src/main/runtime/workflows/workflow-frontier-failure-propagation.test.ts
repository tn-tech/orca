import { describe, expect, it } from 'vitest'
import type { JoinNode, LoopNode } from '../../../shared/workflows/workflow-definition-types'
import { computeFrontier, incomingBranches, latestAttemptByNode } from './workflow-frontier'
import { agent, attempt, end, start, workflow } from './workflow-frontier-test-fixtures'
import { decideJoin } from './workflow-join-policy'
import { bodyIncomingBranches } from './workflow-loop-unrolling'

const join = (onFailure: JoinNode['onFailure']): JoinNode => ({
  id: 'join',
  type: 'join',
  title: 'Join',
  policy: 'all',
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

const failedThenSkipped = [
  attempt('start', 'completed'),
  attempt('a', 'failed'),
  attempt('b', 'skipped'),
  attempt('c', 'completed')
]

describe('failure propagation through skipped nodes', () => {
  it('skips End beside Start->End when the failure is two hops upstream', () => {
    // start -> a -> b -> end, start -> end
    const def = workflow(
      [start, agent('a'), agent('b'), end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'a', to: 'b' },
        { id: 'e3', from: 'b', to: 'end' },
        { id: 'e4', from: 'start', to: 'end' }
      ]
    )
    const attempts = [attempt('start', 'completed'), attempt('a', 'failed')]
    expect(computeFrontier(def, attempts)).toEqual({ eligible: [], skipped: ['b', 'end'] })
  })

  it('reads a node skipped because of a failure as a failed branch', () => {
    const latest = latestAttemptByNode(failedThenSkipped)
    expect(incomingBranches(viaSkipped('fail'), latest, 'join')).toEqual([
      { sourceId: 'b', outcome: 'source-failed' },
      { sourceId: 'c', outcome: 'fired' }
    ])
  })

  it('fails a fail-on-failure Join whose failed branch reached it through a skipped node', () => {
    const def = viaSkipped('fail')
    const decision = decideJoin(
      join('fail'),
      incomingBranches(def, latestAttemptByNode(failedThenSkipped), 'join')
    )
    expect(decision).toMatchObject({ kind: 'fail', reason: 'join_branch_failed' })
  })

  it('keeps tolerant Joins tolerant of a failure reached through a skipped node', () => {
    const branches = (onFailure: JoinNode['onFailure']) =>
      incomingBranches(viaSkipped(onFailure), latestAttemptByNode(failedThenSkipped), 'join')
    expect(decideJoin(join('skip'), branches('skip'))).toEqual({
      kind: 'proceed',
      branches: { b: 'skipped', c: 'completed' }
    })
    expect(decideJoin(join('partial'), branches('partial'))).toEqual({
      kind: 'proceed',
      branches: { b: 'failed', c: 'completed' }
    })
  })

  it('keeps a node skipped by an untaken condition a skipped branch', () => {
    const def = workflow(
      [start, agent('a'), agent('b'), end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'a', to: 'b', condition: { path: 'go', op: 'truthy' } },
        { id: 'e3', from: 'b', to: 'end' },
        { id: 'e4', from: 'start', to: 'end' }
      ]
    )
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'completed', { resultJson: { go: false } })
    ]
    expect(computeFrontier(def, attempts)).toEqual({ eligible: ['end'], skipped: ['b'] })
  })

  it('skips a merge node with an untaken edge beside a failed one', () => {
    // start -> a (conditioned) -> c, start -> b -> c
    const def = workflow(
      [start, agent('a'), agent('b'), agent('c'), end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'b' },
        { id: 'e3', from: 'a', to: 'c', condition: { path: 'go', op: 'truthy' } },
        { id: 'e4', from: 'b', to: 'c' },
        { id: 'e5', from: 'c', to: 'end' }
      ]
    )
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'completed', { resultJson: { go: false } }),
      attempt('b', 'failed')
    ]
    expect(computeFrontier(def, attempts)).toEqual({ eligible: [], skipped: ['c', 'end'] })
  })

  it('passes a failure through a skipped node to a Join inside a Loop body', () => {
    const loop: LoopNode = {
      id: 'qa',
      type: 'loop',
      title: 'QA',
      body: { nodeIds: ['a', 'b', 'c', 'join'] },
      entryNodeId: 'a',
      exitNodeId: 'join',
      maxIterations: 2,
      exitCondition: { path: 'done', op: 'truthy' },
      onCapReached: 'fail'
    }
    const def = workflow(
      [start, loop, agent('a'), agent('b'), agent('c'), join('fail'), end],
      [
        { id: 'in', from: 'start', to: 'qa' },
        { id: 'a-b', from: 'a', to: 'b' },
        { id: 'b-join', from: 'b', to: 'join' },
        { id: 'a-c', from: 'a', to: 'c' },
        { id: 'c-join', from: 'c', to: 'join' },
        { id: 'out', from: 'qa', to: 'end', fromPort: 'exit' }
      ]
    )
    const attempts = [
      { ...attempt('start', 'completed'), id: 'start#0' },
      { ...attempt('qa', 'running'), id: 'qa#0' },
      { ...attempt('a', 'failed'), id: 'a#0' },
      { ...attempt('b', 'skipped'), id: 'b#0' },
      { ...attempt('c', 'completed'), id: 'c#0' }
    ]
    expect(bodyIncomingBranches(def, loop, attempts, 0, 'join')).toEqual([
      { sourceId: 'b', outcome: 'source-failed' },
      { sourceId: 'c', outcome: 'fired' }
    ])
  })
})
