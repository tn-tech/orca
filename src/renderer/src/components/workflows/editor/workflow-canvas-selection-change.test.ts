import { describe, expect, it } from 'vitest'
import { resolveSelectChange } from './workflow-canvas-selection-change'

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
