import { describe, expect, it } from 'vitest'
import { resolveSelectionChange } from './workflow-canvas-selection-change'

describe('resolveSelectionChange (F4 review round 1, Minor #6: keyboard edge selection)', () => {
  it('selects the edge when React Flow reports one', () => {
    expect(resolveSelectionChange({ nodes: [], edges: [{ id: 'edge-1' }] })).toEqual({
      nodeId: undefined,
      edgeId: 'edge-1'
    })
  })

  it('selects the node when React Flow reports one and no edge', () => {
    expect(resolveSelectionChange({ nodes: [{ id: 'node-1' }], edges: [] })).toEqual({
      nodeId: 'node-1',
      edgeId: undefined
    })
  })

  it('clears both when nothing is selected', () => {
    expect(resolveSelectionChange({ nodes: [], edges: [] })).toEqual({
      nodeId: undefined,
      edgeId: undefined
    })
  })

  it('prefers the edge if both are somehow reported together', () => {
    expect(
      resolveSelectionChange({ nodes: [{ id: 'node-1' }], edges: [{ id: 'edge-1' }] })
    ).toEqual({ nodeId: undefined, edgeId: 'edge-1' })
  })
})
