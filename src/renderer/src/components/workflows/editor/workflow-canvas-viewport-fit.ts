/** The visible canvas area in flow coordinates (`WorkflowCanvasAutoFit.tsx`'s container rect,
 *  converted through React Flow's `screenToFlowPosition`). */
export type ViewportRect = { minX: number; minY: number; maxX: number; maxY: number }

export type NodeBox = { x: number; y: number; width: number; height: number }

/** Ids in `currentIds` that weren't in `previousIds` — a freshly added node, not just any node
 *  present this render (F10: distinguishes "just added, might be off screen" from every other
 *  reason the node list re-renders, e.g. a run status update). */
export function newlyAddedNodeIds(
  previousIds: ReadonlySet<string>,
  currentIds: readonly string[]
): string[] {
  return currentIds.filter((id) => !previousIds.has(id))
}

/** True if `box`'s center falls outside `rect` — `WorkflowCanvasAutoFit`'s criterion for "needs
 *  a pan/fit" (F10: "New nodes appear within the visible viewport (pan/fit if needed)"). */
export function isNodeCenterOutOfView(box: NodeBox, rect: ViewportRect): boolean {
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  return centerX < rect.minX || centerX > rect.maxX || centerY < rect.minY || centerY > rect.maxY
}
