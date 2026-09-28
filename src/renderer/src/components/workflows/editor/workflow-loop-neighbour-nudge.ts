import type { Node, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import {
  computeLoopContainerBounds,
  loopParentMap,
  measureWorkflowNodeSize,
  WORKFLOW_LOOP_PADDING
} from './workflow-auto-layout'

export type Box = { x: number; y: number; width: number; height: number }

/** A node's box in absolute layout coordinates — a Loop sibling's own body, not just its own
 *  fixed card, so nudging one Loop out of another Loop's way accounts for its real footprint. */
export function nodeBox(node: Node, layout: Workflow['layout']): Box {
  const position = layout[node.id] ?? { x: 0, y: 0 }
  if (node.type !== 'loop') {
    return { ...position, ...measureWorkflowNodeSize(node) }
  }
  const bodyPositions = node.body.nodeIds.map((id) => layout[id] ?? { x: 0, y: 0 })
  return { ...position, ...computeLoopContainerBounds(position, bodyPositions) }
}

function boxesOverlap(a: Box, b: Box): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

/**
 * Nudges every sibling whose box overlaps the freshly-created Loop's box straight down, clear of
 * it (F10 round 1 review, Important #4: "Loop doesn't overlap neighbours on creation" — a manual
 * placement, or dagre's own `nodesep` (56px) minus the Loop's own padding (40px), can leave a
 * neighbour closer than `WORKFLOW_LOOP_PADDING` to the wrapped selection). Handled here, directly,
 * rather than left to whatever the next "Re-layout" happens to do.
 */
export function nudgeOverlappingSiblings(
  definition: Workflow,
  wrapped: ReadonlySet<string>,
  loopBox: Box
): Workflow['layout'] {
  const parentOf = loopParentMap(definition.nodes)
  const next = { ...definition.layout }
  for (const node of definition.nodes) {
    // A body node only ever moves via its owning Loop's own entry below (the cascade) — checking
    // its own box here too would nudge it a second time, independently, clobbering the cascade.
    if (wrapped.has(node.id) || parentOf.has(node.id)) {
      continue
    }
    const box = nodeBox(node, definition.layout)
    if (!boxesOverlap(box, loopBox)) {
      continue
    }
    const position = definition.layout[node.id] ?? { x: 0, y: 0 }
    const targetY = loopBox.y + loopBox.height + WORKFLOW_LOOP_PADDING
    const deltaY = targetY - position.y
    next[node.id] = { x: position.x, y: targetY }
    // A Loop sibling's body moves with it — same rule `movedLayout` (use-workflow-editor-state.ts)
    // already applies when the user drags a Loop container.
    if (node.type === 'loop') {
      for (const bodyId of node.body.nodeIds) {
        const bodyPosition = definition.layout[bodyId]
        if (bodyPosition) {
          next[bodyId] = { x: bodyPosition.x, y: bodyPosition.y + deltaY }
        }
      }
    }
  }
  return next
}
