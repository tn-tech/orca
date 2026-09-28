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

/** Moves a node (and, if it's a Loop, its body with it) to a new absolute y. */
function moveNodeTo(layout: Workflow['layout'], node: Node, targetY: number): Workflow['layout'] {
  const position = layout[node.id] ?? { x: 0, y: 0 }
  const deltaY = targetY - position.y
  const next = { ...layout, [node.id]: { x: position.x, y: targetY } }
  if (node.type === 'loop') {
    for (const bodyId of node.body.nodeIds) {
      const bodyPosition = layout[bodyId]
      if (bodyPosition) {
        next[bodyId] = { x: bodyPosition.x, y: bodyPosition.y + deltaY }
      }
    }
  }
  return next
}

/** Clears `box` from `blocker` in the given direction, by the shortest distance. */
function clearBelow(blocker: Box): number {
  return blocker.y + blocker.height + WORKFLOW_LOOP_PADDING
}

function clearAbove(blocker: Box, boxHeight: number): number {
  return blocker.y - WORKFLOW_LOOP_PADDING - boxHeight
}

/**
 * Nudges every sibling whose box overlaps the freshly-created Loop's box clear of it — whichever
 * of "below" or "above" the Loop is the shorter move — then keeps sliding that sibling in the same
 * direction past any other node it would otherwise land on, including another nudged sibling.
 */
export function nudgeOverlappingSiblings(
  definition: Workflow,
  wrapped: ReadonlySet<string>,
  loopBox: Box
): Workflow['layout'] {
  const parentOf = loopParentMap(definition.nodes)
  // A body node only ever moves via its owning Loop's own entry, below — considering its own box
  // here too would nudge it a second time, independently, clobbering that cascade.
  const eligible = definition.nodes.filter(
    (node) => !wrapped.has(node.id) && !parentOf.has(node.id)
  )

  let layout = definition.layout
  for (const node of eligible) {
    if (!boxesOverlap(nodeBox(node, layout), loopBox)) {
      continue
    }
    const position = layout[node.id] ?? { x: 0, y: 0 }
    const boxHeight = nodeBox(node, layout).height
    const below = clearBelow(loopBox)
    const above = clearAbove(loopBox, boxHeight)
    const movingDown = Math.abs(below - position.y) <= Math.abs(above - position.y)
    let targetY = movingDown ? below : above
    layout = moveNodeTo(layout, node, targetY)

    let blocker = eligible.find(
      (other) => other.id !== node.id && boxesOverlap(nodeBox(node, layout), nodeBox(other, layout))
    )
    let guard = 0
    while (blocker && guard++ < eligible.length) {
      const blockerBox = nodeBox(blocker, layout)
      targetY = movingDown ? clearBelow(blockerBox) : clearAbove(blockerBox, boxHeight)
      layout = moveNodeTo(layout, node, targetY)
      blocker = eligible.find(
        (other) =>
          other.id !== node.id && boxesOverlap(nodeBox(node, layout), nodeBox(other, layout))
      )
    }
  }
  return layout
}
