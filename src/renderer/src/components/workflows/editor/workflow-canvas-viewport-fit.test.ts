import { describe, expect, it } from 'vitest'
import { isNodeCenterOutOfView, newlyAddedNodeIds } from './workflow-canvas-viewport-fit'

describe('newlyAddedNodeIds', () => {
  it('returns only ids missing from the previous set', () => {
    const previous = new Set(['start', 'end'])

    expect(newlyAddedNodeIds(previous, ['start', 'end', 'agent-1'])).toEqual(['agent-1'])
  })

  it('returns nothing when the node list is unchanged', () => {
    const previous = new Set(['start', 'end'])

    expect(newlyAddedNodeIds(previous, ['start', 'end'])).toEqual([])
  })
})

describe('isNodeCenterOutOfView', () => {
  const rect = { minX: 0, minY: 0, maxX: 1000, maxY: 800 }

  it('is out of view when the node center sits below the visible rect (F10: freeNodePosition places new nodes below the existing layout)', () => {
    const box = { x: 400, y: 2000, width: 220, height: 64 }

    expect(isNodeCenterOutOfView(box, rect)).toBe(true)
  })

  it('is in view when the node center sits inside the visible rect', () => {
    const box = { x: 400, y: 300, width: 220, height: 64 }

    expect(isNodeCenterOutOfView(box, rect)).toBe(false)
  })

  it('is out of view when the node center sits to the right of the visible rect', () => {
    const box = { x: 1500, y: 300, width: 220, height: 64 }

    expect(isNodeCenterOutOfView(box, rect)).toBe(true)
  })
})
