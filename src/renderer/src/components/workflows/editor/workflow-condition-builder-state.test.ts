import { describe, expect, it } from 'vitest'
import type { Condition } from '../../../../../shared/workflows/workflow-definition-types'
import {
  decodeCondition,
  encodeConditionBuilderState,
  EMPTY_CONDITION_BUILDER_STATE,
  type ConditionBuilderState
} from './workflow-condition-builder-state'

function roundTrip(condition: Condition | undefined): Condition | undefined {
  return encodeConditionBuilderState(decodeCondition(condition))
}

describe('workflow-condition-builder-state', () => {
  it('decodes an unconditioned edge to the empty state', () => {
    expect(decodeCondition(undefined)).toEqual(EMPTY_CONDITION_BUILDER_STATE)
    expect(encodeConditionBuilderState(EMPTY_CONDITION_BUILDER_STATE)).toBeUndefined()
  })

  it('round-trips a single leaf condition', () => {
    const condition: Condition = { path: 'approved', op: 'eq', value: true }
    expect(decodeCondition(condition)).toEqual({
      rows: [{ path: 'approved', op: 'eq', value: 'true' }],
      combinator: 'all',
      negate: false,
      unsupported: false
    })
    expect(roundTrip(condition)).toEqual(condition)
  })

  it('round-trips ops that carry no value (truthy/falsy)', () => {
    const condition: Condition = { path: 'approved', op: 'truthy' }
    expect(decodeCondition(condition).rows).toEqual([{ path: 'approved', op: 'truthy', value: '' }])
    expect(roundTrip(condition)).toEqual(condition)
  })

  it('round-trips an `all` combinator over multiple leaves', () => {
    const condition: Condition = {
      all: [
        { path: 'approved', op: 'truthy' },
        { path: 'findings', op: 'lengthGt', value: 0 }
      ]
    }
    const state = decodeCondition(condition)
    expect(state.combinator).toBe('all')
    expect(state.rows).toHaveLength(2)
    expect(roundTrip(condition)).toEqual(condition)
  })

  it('round-trips an `any` combinator', () => {
    const condition: Condition = {
      any: [
        { path: 'status', op: 'eq', value: 'ok' },
        { path: 'status', op: 'eq', value: 'skipped' }
      ]
    }
    expect(decodeCondition(condition).combinator).toBe('any')
    expect(roundTrip(condition)).toEqual(condition)
  })

  it('round-trips a negated leaf', () => {
    const condition: Condition = { not: { path: 'approved', op: 'truthy' } }
    const state = decodeCondition(condition)
    expect(state.negate).toBe(true)
    expect(state.rows).toEqual([{ path: 'approved', op: 'truthy', value: '' }])
    expect(roundTrip(condition)).toEqual(condition)
  })

  it('round-trips a negated combinator', () => {
    const condition: Condition = {
      not: {
        any: [
          { path: 'a', op: 'truthy' },
          { path: 'b', op: 'falsy' }
        ]
      }
    }
    expect(roundTrip(condition)).toEqual(condition)
  })

  it('flags a shape it cannot represent (nested combinator) as unsupported', () => {
    const condition: Condition = {
      all: [{ any: [{ path: 'a', op: 'truthy' }] }, { path: 'b', op: 'truthy' }]
    }
    const state = decodeCondition(condition)
    expect(state.unsupported).toBe(true)
    expect(state.rows).toEqual([])
    // Editing further replaces the unsupported shape rather than guessing at it.
    expect(encodeConditionBuilderState(state)).toBeUndefined()
  })

  it('drops rows with an empty path when encoding', () => {
    const state: ConditionBuilderState = {
      rows: [
        { path: '', op: 'truthy', value: '' },
        { path: 'approved', op: 'truthy', value: '' }
      ],
      combinator: 'all',
      negate: false,
      unsupported: false
    }
    expect(encodeConditionBuilderState(state)).toEqual({ path: 'approved', op: 'truthy' })
  })

  it('parses a JSON-literal value and falls back to a raw string', () => {
    const numeric: Condition = { path: 'count', op: 'gt', value: 3 }
    expect(roundTrip(numeric)).toEqual(numeric)

    const stringValue: Condition = { path: 'status', op: 'eq', value: 'not-json' }
    expect(roundTrip(stringValue)).toEqual(stringValue)

    const boolValue: Condition = { path: 'flag', op: 'eq', value: false }
    expect(roundTrip(boolValue)).toEqual(boolValue)
  })
})
