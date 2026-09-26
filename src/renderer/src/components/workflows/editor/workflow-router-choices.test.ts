import { describe, expect, it } from 'vitest'
import { invalidChoiceIndices, routableChoiceIndices } from './workflow-router-choices'

describe('routableChoiceIndices', () => {
  it('routes every choice when all are non-empty and unique', () => {
    expect(routableChoiceIndices(['bugfix', 'feature'])).toEqual(new Set([0, 1]))
  })

  it('routes only the first occurrence of a repeated choice', () => {
    expect(routableChoiceIndices(['bugfix', 'bugfix', 'feature'])).toEqual(new Set([0, 2]))
  })

  it('never routes a blank choice, even the first one', () => {
    expect(routableChoiceIndices(['', '', 'feature'])).toEqual(new Set([2]))
  })
})

describe('invalidChoiceIndices', () => {
  it('flags nothing when every choice is non-empty and unique', () => {
    expect(invalidChoiceIndices(['bugfix', 'feature'])).toEqual(new Set())
  })

  it('flags every index sharing a repeated choice', () => {
    expect(invalidChoiceIndices(['bugfix', 'bugfix', 'feature'])).toEqual(new Set([0, 1]))
  })

  it('flags every blank choice', () => {
    expect(invalidChoiceIndices(['', 'feature', ''])).toEqual(new Set([0, 2]))
  })
})
