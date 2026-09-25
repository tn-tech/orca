import { describe, expect, it } from 'vitest'
import { classifyIncomingEdge, computeFrontier } from './workflow-frontier'
import { agent, attempt, end, linear, start, workflow } from './workflow-frontier-test-fixtures'

describe('computeFrontier', () => {
  it('makes the start node eligible immediately', () => {
    expect(computeFrontier(linear, [])).toEqual({ eligible: ['start'], skipped: [] })
  })

  it('fires unconditioned edges once the source completes', () => {
    expect(computeFrontier(linear, [attempt('start', 'completed')])).toEqual({
      eligible: ['a'],
      skipped: []
    })
  })

  it('does not re-offer nodes that already have an attempt', () => {
    const attempts = [attempt('start', 'completed'), attempt('a', 'running')]
    expect(computeFrontier(linear, attempts)).toEqual({ eligible: [], skipped: [] })
  })

  it('waits until every incoming edge source completed', () => {
    // start -> a, start -> b, a -> c, b -> c
    const def = workflow(
      [start, agent('a'), agent('b'), agent('c'), end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'b' },
        { id: 'e3', from: 'a', to: 'c' },
        { id: 'e4', from: 'b', to: 'c' },
        { id: 'e5', from: 'c', to: 'end' }
      ]
    )
    const partial = [
      attempt('start', 'completed'),
      attempt('a', 'completed'),
      attempt('b', 'running')
    ]
    expect(computeFrontier(def, partial).eligible).toEqual([])
    const done = [...partial.slice(0, 2), attempt('b', 'completed')]
    expect(computeFrontier(def, done).eligible).toEqual(['c'])
  })

  it('requires a conditioned edge to pass against the source result only', () => {
    const def = workflow(
      [start, agent('a'), agent('b'), end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        {
          id: 'e2',
          from: 'a',
          to: 'b',
          condition: { path: 'verdict', op: 'eq', value: 'ship' }
        },
        { id: 'e3', from: 'b', to: 'end' }
      ]
    )
    const passing = [
      attempt('start', 'completed'),
      attempt('a', 'completed', { resultJson: { verdict: 'ship' } })
    ]
    expect(computeFrontier(def, passing)).toEqual({ eligible: ['b'], skipped: [] })

    const failing = [
      attempt('start', 'completed'),
      attempt('a', 'completed', { resultJson: { verdict: 'hold' } })
    ]
    expect(computeFrontier(def, failing)).toEqual({ eligible: [], skipped: ['b', 'end'] })
  })

  it('skips a node whose upstream failed and propagates the skip downstream', () => {
    const attempts = [attempt('start', 'completed'), attempt('a', 'failed')]
    expect(computeFrontier(linear, attempts)).toEqual({ eligible: [], skipped: ['b', 'end'] })
  })

  it('skips a node whose upstream was skipped or cancelled', () => {
    expect(
      computeFrontier(linear, [attempt('start', 'completed'), attempt('a', 'skipped')]).skipped
    ).toEqual(['b', 'end'])
    expect(
      computeFrontier(linear, [attempt('start', 'completed'), attempt('a', 'cancelled')]).skipped
    ).toEqual(['b', 'end'])
  })

  it('skips on a blocked edge even while another upstream is still running', () => {
    const def = workflow(
      [start, agent('a'), agent('b'), agent('c'), end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'b' },
        { id: 'e3', from: 'a', to: 'c' },
        { id: 'e4', from: 'b', to: 'c' },
        { id: 'e5', from: 'c', to: 'end' }
      ]
    )
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'failed'),
      attempt('b', 'running')
    ]
    expect(computeFrontier(def, attempts)).toEqual({ eligible: [], skipped: ['c', 'end'] })
  })

  it('reads the latest attempt of a node', () => {
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'failed', { attemptIndex: 0 }),
      attempt('a', 'completed', { attemptIndex: 1 })
    ]
    expect(computeFrontier(linear, attempts)).toEqual({ eligible: ['b'], skipped: [] })
  })

  it('leaves node types handled by later phases pending without crashing', () => {
    const def = workflow(
      [
        start,
        agent('a'),
        agent('b'),
        { id: 'join', type: 'join', title: 'Join', policy: 'all', onFailure: 'fail' },
        {
          id: 'gate',
          type: 'approval',
          title: 'Gate',
          question: 'ok?',
          options: ['yes'],
          timeoutMs: 1000,
          escalationGraceMs: 1000
        },
        end
      ],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'b' },
        { id: 'e3', from: 'a', to: 'join' },
        { id: 'e4', from: 'b', to: 'join' },
        { id: 'e5', from: 'join', to: 'gate' },
        { id: 'e6', from: 'gate', to: 'end', fromPort: 'yes' }
      ]
    )
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'completed'),
      attempt('b', 'failed')
    ]
    expect(computeFrontier(def, attempts)).toEqual({ eligible: [], skipped: [] })
  })
})

describe('classifyIncomingEdge', () => {
  it('reports each edge outcome so a Join can apply its own policy', () => {
    const def = workflow(
      [start, agent('a'), agent('b'), agent('c'), end],
      [
        { id: 'fired', from: 'start', to: 'a' },
        { id: 'failed', from: 'a', to: 'end' },
        { id: 'skipped', from: 'b', to: 'end' },
        { id: 'open', from: 'c', to: 'end' },
        {
          id: 'not-taken',
          from: 'start',
          to: 'b',
          condition: { path: 'x', op: 'truthy' }
        }
      ]
    )
    const attempts = [
      attempt('start', 'completed', { resultJson: {} }),
      attempt('a', 'failed'),
      attempt('b', 'skipped'),
      attempt('c', 'running')
    ]
    const outcome = (id: string): string => {
      const edge = def.edges.find((candidate) => candidate.id === id)
      if (!edge) {
        throw new Error(id)
      }
      return classifyIncomingEdge(edge, attempts)
    }
    expect(outcome('fired')).toBe('fired')
    expect(outcome('failed')).toBe('source-failed')
    expect(outcome('skipped')).toBe('source-skipped')
    expect(outcome('open')).toBe('unresolved')
    expect(outcome('not-taken')).toBe('not-taken')
  })
})
