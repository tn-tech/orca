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

  describe('implicit merge on a node with several incoming edges', () => {
    // start -> a; a -> b if go; a -> c if !go; b -> end; c -> end
    const branching = workflow(
      [start, agent('a'), agent('b'), agent('c'), end],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'a', to: 'b', condition: { path: 'go', op: 'truthy' } },
        { id: 'e3', from: 'a', to: 'c', condition: { path: 'go', op: 'falsy' } },
        { id: 'e4', from: 'b', to: 'end' },
        { id: 'e5', from: 'c', to: 'end' }
      ]
    )

    it('runs End when one conditional branch was not taken', () => {
      const attempts = [
        attempt('start', 'completed'),
        attempt('a', 'completed', { resultJson: { go: true } }),
        attempt('b', 'completed')
      ]
      expect(computeFrontier(branching, attempts)).toEqual({ eligible: ['end'], skipped: ['c'] })
    })

    it('skips End when every incoming edge is blocked', () => {
      const attempts = [
        attempt('start', 'completed'),
        attempt('a', 'completed', { resultJson: { go: true } }),
        attempt('b', 'failed')
      ]
      expect(computeFrontier(branching, attempts)).toEqual({
        eligible: [],
        skipped: ['c', 'end']
      })
    })

    it('keeps End pending while an incoming edge is still unresolved', () => {
      const attempts = [
        attempt('start', 'completed'),
        attempt('a', 'completed', { resultJson: { go: true } }),
        attempt('b', 'running')
      ]
      expect(computeFrontier(branching, attempts)).toEqual({ eligible: [], skipped: ['c'] })
    })

    it('keeps a merge node pending when one upstream failed and another is still running', () => {
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
      const running = [
        attempt('start', 'completed'),
        attempt('a', 'failed'),
        attempt('b', 'running')
      ]
      expect(computeFrontier(def, running)).toEqual({ eligible: [], skipped: [] })
      const done = [
        attempt('start', 'completed'),
        attempt('a', 'failed'),
        attempt('b', 'completed')
      ]
      expect(computeFrontier(def, done)).toEqual({ eligible: ['c'], skipped: [] })
    })
  })

  it('reads the latest attempt of a node', () => {
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'failed', { attemptIndex: 0 }),
      attempt('a', 'completed', { attemptIndex: 1 })
    ]
    expect(computeFrontier(linear, attempts)).toEqual({ eligible: ['b'], skipped: [] })
  })

  it('offers a Reflection once the Join before it completes', () => {
    const def = workflow(
      [
        start,
        agent('a'),
        agent('b'),
        { id: 'join', type: 'join', title: 'Join', policy: 'all', onFailure: 'fail' },
        { id: 'gate', type: 'reflection', title: 'Gate', prompt: 'Reflect.' },
        end
      ],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'b' },
        { id: 'e3', from: 'a', to: 'join' },
        { id: 'e4', from: 'b', to: 'join' },
        { id: 'e5', from: 'join', to: 'gate' },
        { id: 'e6', from: 'gate', to: 'end' }
      ]
    )
    const attempts = [
      attempt('start', 'completed'),
      attempt('a', 'completed'),
      attempt('b', 'completed'),
      attempt('join', 'completed')
    ]
    expect(computeFrontier(def, attempts)).toEqual({ eligible: ['gate'], skipped: [] })
  })
})

describe('Approval option ports', () => {
  // start -> gate -(approve)-> a, gate -(reject)-> b
  const def = workflow(
    [
      start,
      {
        id: 'gate',
        type: 'approval',
        title: 'Gate',
        question: 'ok?',
        options: ['approve', 'reject'],
        timeoutMs: 1000,
        escalationGraceMs: 1000
      },
      agent('a'),
      agent('b'),
      end
    ],
    [
      { id: 'e1', from: 'start', to: 'gate' },
      { id: 'e2', from: 'gate', to: 'a', fromPort: 'approve' },
      { id: 'e3', from: 'gate', to: 'b', fromPort: 'reject' },
      { id: 'e4', from: 'a', to: 'end' },
      { id: 'e5', from: 'b', to: 'end' }
    ]
  )

  it('offers an Approval and holds its option edges until it completes', () => {
    const started = [attempt('start', 'completed')]
    expect(computeFrontier(def, started)).toEqual({ eligible: ['gate'], skipped: [] })
    expect(computeFrontier(def, [...started, attempt('gate', 'waiting')])).toEqual({
      eligible: [],
      skipped: []
    })
  })

  it('fires only the edge of the chosen option', () => {
    const answered = [
      attempt('start', 'completed'),
      attempt('gate', 'completed', { resultJson: { option: 'reject' } })
    ]
    expect(computeFrontier(def, answered)).toEqual({ eligible: ['b'], skipped: ['a'] })
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

  it('reads skips only from persisted attempts (the controller records every frontier skip)', () => {
    const edge = linear.edges[1]
    expect(classifyIncomingEdge(edge, [attempt('a', 'skipped')])).toBe('source-skipped')
    expect(classifyIncomingEdge(edge, [])).toBe('unresolved')
  })
})
