import { describe, expect, it } from 'vitest'
import type { JoinNode, Node } from '../../../shared/workflows/workflow-definition-types'
import { computeFrontier } from './workflow-frontier'
import { agent, attempt, end, start, workflow } from './workflow-frontier-test-fixtures'
import { decideJoin, type IncomingBranch } from './workflow-join-policy'
import { computeLoopProgress } from './workflow-loop-unrolling'

function join(policy: JoinNode['policy'], onFailure: JoinNode['onFailure']): JoinNode {
  return { id: 'join', type: 'join', title: 'Join', policy, onFailure }
}

const branch = (sourceId: string, outcome: IncomingBranch['outcome']): IncomingBranch => ({
  sourceId,
  outcome
})

describe('decideJoin', () => {
  it('`all` waits for the last branch', () => {
    const node = join('all', 'fail')
    expect(
      decideJoin(node, [branch('a', 'fired'), branch('b', 'fired'), branch('c', 'unresolved')])
    ).toEqual({ kind: 'waiting' })
    expect(
      decideJoin(node, [branch('a', 'fired'), branch('b', 'fired'), branch('c', 'fired')])
    ).toEqual({
      kind: 'proceed',
      branches: { a: 'completed', b: 'completed', c: 'completed' }
    })
  })

  it('`all` counts a skipped or not-taken branch as satisfied', () => {
    expect(
      decideJoin(join('all', 'fail'), [
        branch('a', 'fired'),
        branch('b', 'source-skipped'),
        branch('c', 'not-taken')
      ])
    ).toEqual({ kind: 'proceed', branches: { a: 'completed', b: 'skipped', c: 'skipped' } })
  })

  it('is skipped when every branch was skipped, like any other merge node', () => {
    expect(
      decideJoin(join('all', 'partial'), [branch('a', 'source-skipped'), branch('b', 'not-taken')])
    ).toEqual({ kind: 'skip' })
  })

  it('`any` proceeds on the first completed branch while others still run', () => {
    const node = join('any', 'partial')
    expect(decideJoin(node, [branch('a', 'unresolved'), branch('b', 'unresolved')])).toEqual({
      kind: 'waiting'
    })
    expect(decideJoin(node, [branch('a', 'unresolved'), branch('b', 'fired')])).toEqual({
      kind: 'proceed',
      branches: { a: 'pending', b: 'completed' }
    })
  })

  it('`quorum(n)` proceeds once n branches completed', () => {
    const node = join({ quorum: 2 }, 'partial')
    const branches = [branch('a', 'fired'), branch('b', 'unresolved'), branch('c', 'unresolved')]
    expect(decideJoin(node, branches)).toEqual({ kind: 'waiting' })
    expect(decideJoin(node, [...branches.slice(0, 2), branch('c', 'fired')])).toEqual({
      kind: 'proceed',
      branches: { a: 'completed', b: 'pending', c: 'completed' }
    })
  })

  it('`quorum(n)` fails as soon as n completions are out of reach', () => {
    expect(
      decideJoin(join({ quorum: 2 }, 'partial'), [
        branch('a', 'source-failed'),
        branch('b', 'source-failed'),
        branch('c', 'unresolved')
      ])
    ).toEqual({
      kind: 'fail',
      reason: 'join_unsatisfied',
      branches: { a: 'failed', b: 'failed', c: 'pending' }
    })
  })

  it('`onFailure: fail` fails the join on the first failed branch and names running siblings', () => {
    expect(
      decideJoin(join('all', 'fail'), [
        branch('a', 'fired'),
        branch('b', 'source-failed'),
        branch('c', 'unresolved')
      ])
    ).toEqual({
      kind: 'fail',
      reason: 'join_branch_failed',
      branches: { a: 'completed', b: 'failed', c: 'pending' }
    })
  })

  it('`onFailure: skip` treats failed branches as skipped', () => {
    expect(
      decideJoin(join('all', 'skip'), [branch('a', 'fired'), branch('b', 'source-failed')])
    ).toEqual({ kind: 'proceed', branches: { a: 'completed', b: 'skipped' } })
    expect(
      decideJoin(join('any', 'skip'), [branch('a', 'source-failed'), branch('b', 'source-failed')])
    ).toEqual({ kind: 'skip' })
  })

  it('`onFailure: partial` proceeds once the rest complete and reports each branch outcome', () => {
    const node = join('all', 'partial')
    expect(decideJoin(node, [branch('a', 'source-failed'), branch('b', 'unresolved')])).toEqual({
      kind: 'waiting'
    })
    expect(decideJoin(node, [branch('a', 'source-failed'), branch('b', 'fired')])).toEqual({
      kind: 'proceed',
      branches: { a: 'failed', b: 'completed' }
    })
  })

  it('fails rather than skips a Join whose quorum is out of reach after a completion', () => {
    expect(
      decideJoin(join({ quorum: 2 }, 'fail'), [branch('a', 'fired'), branch('b', 'not-taken')])
    ).toEqual({
      kind: 'fail',
      reason: 'join_unsatisfied',
      branches: { a: 'completed', b: 'skipped' }
    })
  })

  it('`onFailure: partial` fails when no branch completed', () => {
    expect(
      decideJoin(join('all', 'partial'), [branch('a', 'source-failed'), branch('b', 'not-taken')])
    ).toEqual({ kind: 'fail', reason: 'join_unsatisfied', branches: { a: 'failed', b: 'skipped' } })
  })
})

describe('computeFrontier with a Join', () => {
  // start -> a|b|c -> join -> end
  function fanOut(node: Node) {
    return workflow(
      [start, agent('a'), agent('b'), agent('c'), node, end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'b' },
        { id: 'e3', from: 'start', to: 'c' },
        { id: 'e4', from: 'a', to: 'join' },
        { id: 'e5', from: 'b', to: 'join' },
        { id: 'e6', from: 'c', to: 'join' },
        { id: 'e7', from: 'join', to: 'end' }
      ]
    )
  }

  it('offers the Join to open Waiting on the first settled branch, then only to settle it', () => {
    const def = fanOut(join('all', 'fail'))
    const unsettled = [
      attempt('start', 'completed'),
      attempt('a', 'running'),
      attempt('b', 'running'),
      attempt('c', 'running')
    ]
    expect(computeFrontier(def, unsettled)).toEqual({ eligible: [], skipped: [] })
    const running = [
      attempt('start', 'completed'),
      attempt('a', 'completed'),
      attempt('b', 'completed'),
      attempt('c', 'running')
    ]
    expect(computeFrontier(def, running)).toEqual({ eligible: ['join'], skipped: [] })
    const waiting = [...running, attempt('join', 'waiting')]
    expect(computeFrontier(def, waiting)).toEqual({ eligible: [], skipped: [] })
    const failed = [...running.slice(0, 3), attempt('c', 'failed'), attempt('join', 'waiting')]
    expect(computeFrontier(def, failed)).toEqual({ eligible: ['join'], skipped: [] })
    const anyDef = fanOut(join('any', 'fail'))
    const firstDone = [...running.slice(0, 2), attempt('b', 'running'), attempt('c', 'running')]
    expect(computeFrontier(anyDef, firstDone)).toEqual({
      eligible: ['join'],
      skipped: []
    })
  })

  it('cascades a skipped Join to its downstream nodes', () => {
    const def = fanOut(join('any', 'skip'))
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'failed'),
      attempt('b', 'skipped'),
      attempt('c', 'cancelled')
    ]
    expect(computeFrontier(def, attempts)).toEqual({ eligible: [], skipped: ['join', 'end'] })
  })

  it('fires the Join edge only when the Join attempt completed', () => {
    const def = fanOut(join('all', 'fail'))
    const settled = [
      attempt('start', 'completed'),
      attempt('a', 'completed'),
      attempt('b', 'completed'),
      attempt('c', 'completed')
    ]
    expect(computeFrontier(def, [...settled, attempt('join', 'completed')]).eligible).toEqual([
      'end'
    ])
    expect(computeFrontier(def, [...settled, attempt('join', 'failed')]).skipped).toEqual(['end'])
  })
})

describe('a Join inside a Loop body', () => {
  // start -> loop{ a -> b|c -> join } -> end
  const def = workflow(
    [
      start,
      {
        id: 'qa',
        type: 'loop',
        title: 'QA',
        body: { nodeIds: ['a', 'b', 'c', 'join'] },
        entryNodeId: 'a',
        exitNodeId: 'join',
        maxIterations: 2,
        exitCondition: { path: 'branches.b', op: 'eq', value: 'completed' },
        onCapReached: 'fail'
      },
      agent('a'),
      agent('b'),
      agent('c'),
      join('all', 'partial'),
      end
    ],
    [
      { id: 'e1', from: 'start', to: 'qa' },
      { id: 'e2', from: 'a', to: 'b' },
      { id: 'e3', from: 'a', to: 'c' },
      { id: 'e4', from: 'b', to: 'join' },
      { id: 'e5', from: 'c', to: 'join' },
      { id: 'e6', from: 'join', to: 'a', fromPort: 'body' },
      { id: 'e7', from: 'qa', to: 'end', fromPort: 'exit' }
    ]
  )
  const at = (nodeId: string, state: Parameters<typeof attempt>[1]) => ({
    ...attempt(nodeId, state),
    id: nodeId
  })

  it('applies the same policy per iteration, including the Waiting attempt', () => {
    const base = [at('start', 'completed'), at('qa', 'running'), at('a', 'completed')]
    const waiting = [...base, at('b', 'failed'), at('join', 'waiting')]
    expect(computeLoopProgress(def, [...waiting, at('c', 'running')]).eligible).toEqual([])
    expect(computeLoopProgress(def, [...waiting, at('c', 'completed')]).eligible).toEqual([
      { nodeId: 'join', iteration: 0 }
    ])
    expect(computeLoopProgress(def, [...waiting, at('c', 'completed')]).settlements).toEqual([])
  })
})
