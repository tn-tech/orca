import { describe, expect, it } from 'vitest'
import type { Condition } from './workflow-definition-types'
import { evaluateCondition } from './workflow-condition-evaluation'

describe('evaluateCondition — leaf ops', () => {
  it('eq: true when the dot-path value strictly/deep-equals value', () => {
    expect(evaluateCondition({ path: 'a.b', op: 'eq', value: 3 }, { a: { b: 3 } })).toBe(true)
    expect(evaluateCondition({ path: 'a.b', op: 'eq', value: 3 }, { a: { b: 4 } })).toBe(false)
    expect(evaluateCondition({ path: 'a', op: 'eq', value: { x: 1 } }, { a: { x: 1 } })).toBe(true)
  })

  it('neq: true when the dot-path value differs from value', () => {
    expect(evaluateCondition({ path: 'a', op: 'neq', value: 1 }, { a: 2 })).toBe(true)
    expect(evaluateCondition({ path: 'a', op: 'neq', value: 1 }, { a: 1 })).toBe(false)
  })

  it('gt/gte/lt/lte: numeric comparisons, false for non-numeric operands', () => {
    expect(evaluateCondition({ path: 'n', op: 'gt', value: 3 }, { n: 4 })).toBe(true)
    expect(evaluateCondition({ path: 'n', op: 'gt', value: 3 }, { n: 3 })).toBe(false)
    expect(evaluateCondition({ path: 'n', op: 'gte', value: 3 }, { n: 3 })).toBe(true)
    expect(evaluateCondition({ path: 'n', op: 'lt', value: 3 }, { n: 2 })).toBe(true)
    expect(evaluateCondition({ path: 'n', op: 'lte', value: 3 }, { n: 3 })).toBe(true)
    expect(evaluateCondition({ path: 'n', op: 'gt', value: 3 }, { n: 'not a number' })).toBe(false)
  })

  it('truthy/falsy over the dot-path value', () => {
    expect(evaluateCondition({ path: 'ok', op: 'truthy' }, { ok: 1 })).toBe(true)
    expect(evaluateCondition({ path: 'ok', op: 'truthy' }, { ok: 0 })).toBe(false)
    expect(evaluateCondition({ path: 'ok', op: 'falsy' }, { ok: 0 })).toBe(true)
    expect(evaluateCondition({ path: 'ok', op: 'falsy' }, { ok: 1 })).toBe(false)
  })

  it('contains: array membership (deep-equal element) or string substring', () => {
    expect(
      evaluateCondition({ path: 'tags', op: 'contains', value: 'x' }, { tags: ['x', 'y'] })
    ).toBe(true)
    expect(
      evaluateCondition({ path: 'tags', op: 'contains', value: 'z' }, { tags: ['x', 'y'] })
    ).toBe(false)
    expect(evaluateCondition({ path: 's', op: 'contains', value: 'ell' }, { s: 'hello' })).toBe(
      true
    )
    expect(evaluateCondition({ path: 's', op: 'contains', value: 'zzz' }, { s: 'hello' })).toBe(
      false
    )
  })

  it('lengthGt: array/string length greater than value', () => {
    expect(evaluateCondition({ path: 'items', op: 'lengthGt', value: 1 }, { items: [1, 2] })).toBe(
      true
    )
    expect(evaluateCondition({ path: 'items', op: 'lengthGt', value: 2 }, { items: [1, 2] })).toBe(
      false
    )
    expect(evaluateCondition({ path: 's', op: 'lengthGt', value: 2 }, { s: 'abcd' })).toBe(true)
  })

  it('missing paths evaluate false for value-comparing ops', () => {
    expect(evaluateCondition({ path: 'missing.x', op: 'eq', value: 'y' }, {})).toBe(false)
    expect(evaluateCondition({ path: 'missing.x', op: 'gt', value: 1 }, {})).toBe(false)
    expect(evaluateCondition({ path: 'missing.x', op: 'contains', value: 'y' }, {})).toBe(false)
    expect(evaluateCondition({ path: 'missing.x', op: 'lengthGt', value: 0 }, {})).toBe(false)
    expect(evaluateCondition({ path: 'missing.x', op: 'truthy' }, {})).toBe(false)
  })
})

describe('evaluateCondition — all/any/not', () => {
  it('all: every nested condition must hold, vacuously true when empty', () => {
    const condition: Condition = {
      all: [
        { path: 'a', op: 'truthy' },
        { path: 'b', op: 'truthy' }
      ]
    }
    expect(evaluateCondition(condition, { a: true, b: true })).toBe(true)
    expect(evaluateCondition(condition, { a: true, b: false })).toBe(false)
    expect(evaluateCondition({ all: [] }, {})).toBe(true)
  })

  it('any: at least one nested condition holds, false when empty', () => {
    const condition: Condition = {
      any: [
        { path: 'a', op: 'truthy' },
        { path: 'b', op: 'truthy' }
      ]
    }
    expect(evaluateCondition(condition, { a: false, b: true })).toBe(true)
    expect(evaluateCondition(condition, { a: false, b: false })).toBe(false)
    expect(evaluateCondition({ any: [] }, {})).toBe(false)
  })

  it('not: negates the nested condition', () => {
    const condition: Condition = { not: { path: 'a', op: 'truthy' } }
    expect(evaluateCondition(condition, { a: false })).toBe(true)
    expect(evaluateCondition(condition, { a: true })).toBe(false)
  })

  it('nests all/any/not arbitrarily deep, including missing paths inside nesting', () => {
    const condition: Condition = {
      all: [
        { not: { path: 'missing', op: 'truthy' } },
        {
          any: [
            { path: 'score', op: 'gte', value: 10 },
            { path: 'override', op: 'truthy' }
          ]
        }
      ]
    }
    expect(evaluateCondition(condition, { score: 12 })).toBe(true)
    expect(evaluateCondition(condition, { score: 1 })).toBe(false)
  })
})
