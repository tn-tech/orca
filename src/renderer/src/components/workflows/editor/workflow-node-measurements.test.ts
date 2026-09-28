import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearMeasuredNodeSizes,
  getMeasuredNodeSizes,
  setMeasuredNodeSize
} from './workflow-node-measurements'

beforeEach(() => {
  clearMeasuredNodeSizes()
})

describe('workflow-node-measurements', () => {
  it('returns a recorded size', () => {
    setMeasuredNodeSize('a', { width: 220, height: 96 })

    expect(getMeasuredNodeSizes().get('a')).toEqual({ width: 220, height: 96 })
  })

  it('returns an empty registry after clearing', () => {
    setMeasuredNodeSize('a', { width: 220, height: 96 })

    clearMeasuredNodeSizes()

    expect(getMeasuredNodeSizes().size).toBe(0)
  })

  it('returns a snapshot that does not reflect a later write', () => {
    setMeasuredNodeSize('a', { width: 220, height: 96 })

    const snapshot = getMeasuredNodeSizes()
    setMeasuredNodeSize('a', { width: 220, height: 999 })

    expect(snapshot.get('a')).toEqual({ width: 220, height: 96 })
  })
})
