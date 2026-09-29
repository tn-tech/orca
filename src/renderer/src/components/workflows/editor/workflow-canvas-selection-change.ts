import type {
  EdgeChange,
  EdgeSelectionChange,
  NodeChange,
  NodeSelectionChange
} from '@xyflow/react'

/**
 * F4 re-review 1: keyboard selection (Tab focuses, Enter selects — `nodesFocusable`/
 * `edgesFocusable` default to `true`) reaches this controlled canvas only through a `select`-type
 * change in the array `onNodesChange`/`onEdgesChange` receive — that is how React Flow's own
 * `addSelectedNodes`/`addSelectedEdges` report it (`triggerNodeChanges`/`triggerEdgeChanges` in
 * `node_modules/@xyflow/react`). `onSelectionChange` (see `resolveSelectionChange` below) does
 * NOT independently drive this: it only fires after the store's own selection has already
 * changed, which never happens for keyboard selection unless something reacts to that `select`
 * change first — round 1's version of this comment claimed `onSelectionChange` was "the missing
 * piece", which was false (F4 re-review 1, Minor #6). `WorkflowCanvas` now calls this from both
 * `onNodesChange` and `onEdgesChange` (both report the same change shape) to turn a batch of
 * changes into "the selection should become this id", "the selection should clear", or "this
 * batch isn't about selection at all" (e.g. a drag's `position` changes) — a select-true always
 * wins over a select-false in the same batch, matching Enter moving the selection from one
 * element to another in one change array.
 */
export function resolveSelectChange(changes: readonly (NodeChange | EdgeChange)[]): {
  changed: boolean
  id: string | undefined
} {
  const selected = changes.find(
    (change): change is NodeSelectionChange | EdgeSelectionChange =>
      change.type === 'select' && change.selected === true
  )
  if (selected) {
    return { changed: true, id: selected.id }
  }
  const deselected = changes.some((change) => change.type === 'select' && change.selected === false)
  return deselected ? { changed: true, id: undefined } : { changed: false, id: undefined }
}
