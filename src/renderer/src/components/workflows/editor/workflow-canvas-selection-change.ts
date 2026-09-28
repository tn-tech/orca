/**
 * F4 review round 1, Minor #6: React Flow already lets Tab cycle focus across nodes/edges and
 * Enter select the focused one (`nodesFocusable`/`edgesFocusable` default to `true`, so edges
 * were already keyboard-reachable) — the missing piece was feeding that selection back into
 * `WorkflowCanvas`'s own controlled `selectedNodeId`/`selectedEdgeId` state the way a click
 * already does, so the very next render's derived `nodes`/`edges` props don't just stomp it back
 * to unselected. `onSelectionChange` fires for both keyboard and mouse selection, so
 * `WorkflowCanvas` runs this alongside (not instead of) its click handlers; the two agree on
 * every case a click already covers, so there's no fight, just a harmless duplicate call. Prefers
 * an edge over a node when both would somehow be reported (box-select isn't offered, so
 * `nodes`/`edges` never have more than one entry each in practice). Split into its own file, and
 * exported, because no test in this codebase mounts `@xyflow/react`'s real DOM (see
 * `WorkflowCanvas.test.tsx`) — this keeps the selection-resolution logic itself covered.
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
