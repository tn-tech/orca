import { describe, expect, it } from 'vitest'
import {
  resolveSelectChange,
  resolveSelectionChange,
  selectionToReport
} from './workflow-canvas-selection-change'

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

describe('resolveSelectChange (F4 re-review 1: keyboard selection actually reaches onNodesChange/onEdgesChange)', () => {
  it('reports the newly selected id for a select-true change', () => {
    expect(resolveSelectChange([{ type: 'select', id: 'node-1', selected: true }])).toEqual({
      changed: true,
      id: 'node-1'
    })
  })

  it('reports a clear for a lone select-false change', () => {
    expect(resolveSelectChange([{ type: 'select', id: 'node-1', selected: false }])).toEqual({
      changed: true,
      id: undefined
    })
  })

  it('prefers a select-true over a select-false in the same batch (Enter moving selection)', () => {
    expect(
      resolveSelectChange([
        { type: 'select', id: 'old', selected: false },
        { type: 'select', id: 'new', selected: true }
      ])
    ).toEqual({ changed: true, id: 'new' })
  })

  it('reports no change for a batch with no select change (e.g. a drag position update)', () => {
    expect(
      resolveSelectChange([{ type: 'position', id: 'node-1', position: { x: 0, y: 0 } }])
    ).toEqual({ changed: false, id: undefined })
  })

  it('reports no change for an empty batch', () => {
    expect(resolveSelectChange([])).toEqual({ changed: false, id: undefined })
  })
})

describe('selectionToReport (F9: a stale empty report must not clear the controlled selection)', () => {
  it('is null when React Flow reports nothing selected, so it cannot undo a just-made selection', () => {
    expect(selectionToReport({ nodes: [], edges: [] })).toBeNull()
  })

  it('reports the selected node', () => {
    expect(selectionToReport({ nodes: [{ id: 'node-1' }], edges: [] })).toEqual({
      nodeId: 'node-1',
      edgeId: undefined
    })
  })

  it('reports the selected edge', () => {
    expect(selectionToReport({ nodes: [], edges: [{ id: 'edge-1' }] })).toEqual({
      nodeId: undefined,
      edgeId: 'edge-1'
    })
  })
})
