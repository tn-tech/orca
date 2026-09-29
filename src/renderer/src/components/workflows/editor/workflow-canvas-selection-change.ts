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

/**
 * A redundant safety net, not the fix for keyboard selection (see `resolveSelectChange` above,
 * F4 re-review 1, Minor #6 — this file's own comment used to claim otherwise). React Flow calls
 * `onSelectionChange` whenever its internal store's selected nodes/edges change for any reason;
 * with `resolveSelectChange` now wired into both `onNodesChange` and `onEdgesChange`, every case
 * this canvas cares about (click, keyboard) is already handled before `onSelectionChange` would
 * even fire, so this mostly re-reports the same outcome. Prefers an edge over a node when both
 * would somehow be reported (box-select isn't offered, so `nodes`/`edges` never have more than
 * one entry each in practice). Exported because no test in this codebase mounts `@xyflow/react`'s
 * real DOM (see `WorkflowCanvas.test.tsx`) — this keeps the resolution logic itself covered.
 */
export function resolveSelectionChange(params: {
  nodes: readonly { id: string }[]
  edges: readonly { id: string }[]
}): { nodeId: string | undefined; edgeId: string | undefined } {
  const edge = params.edges[0]
  if (edge) {
    return { nodeId: undefined, edgeId: edge.id }
  }
  return { nodeId: params.nodes[0]?.id, edgeId: undefined }
}

/** What `onSelectionChange` may forward, or null when nothing is selected. Clearing is owned by
 *  pane clicks and `select: false` changes: this callback lags the controlled `selected` prop, so
 *  forwarding its empty report undoes a fresh selection and the two ping-pong forever (F9). */
export function selectionToReport(params: {
  nodes: readonly { id: string }[]
  edges: readonly { id: string }[]
}): { nodeId: string | undefined; edgeId: string | undefined } | null {
  const resolved = resolveSelectionChange(params)
  return resolved.nodeId === undefined && resolved.edgeId === undefined ? null : resolved
}
