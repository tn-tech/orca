import type {
  Edge as WorkflowEdge,
  Layout,
  Node as WorkflowNode
} from '../../../../../shared/workflows/workflow-definition-types'
import {
  computeLoopContainerBounds,
  loopParentMap,
  measureWorkflowNodeSize
} from './workflow-auto-layout'

/** Clearance (px) kept between a bent edge's lane and the boxes it steps around. */
const EDGE_CLEARANCE_MARGIN = 16

type Box = { id: string; x: number; y: number; width: number; height: number }

function topLevelBoxes(nodes: readonly WorkflowNode[], layout: Layout): Box[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const parentOf = loopParentMap(nodes)
  return nodes
    .filter((node) => !parentOf.has(node.id))
    .map((node) => {
      const position = layout[node.id] ?? { x: 0, y: 0 }
      if (node.type !== 'loop') {
        return { id: node.id, ...position, ...measureWorkflowNodeSize(node) }
      }
      const bodyPositions = node.body.nodeIds.map((id) => {
        const bodyNode = nodeById.get(id)
        const bodyPosition = layout[id] ?? { x: 0, y: 0 }
        return { ...bodyPosition, ...(bodyNode ? measureWorkflowNodeSize(bodyNode) : {}) }
      })
      return { id: node.id, ...position, ...computeLoopContainerBounds(position, bodyPositions) }
    })
}

/** The straight line's y at `x`, linearly interpolated between the two endpoints. */
function interpolatedY(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x2 === x1) {
    return y1
  }
  return y1 + ((x - x1) / (x2 - x1)) * (y2 - y1)
}

/** Every box (other than the edge's own endpoints) whose horizontal span sits between the two
 *  points and whose vertical span the straight line would pass through. */
function boxesInTheWay(
  boxes: readonly Box[],
  excludeIds: ReadonlySet<string>,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Box[] {
  const minX = Math.min(x1, x2)
  const maxX = Math.max(x1, x2)
  return boxes.filter((box) => {
    if (excludeIds.has(box.id)) {
      return false
    }
    const centerX = box.x + box.width / 2
    if (centerX <= minX || centerX >= maxX) {
      return false
    }
    const lineY = interpolatedY(x1, y1, x2, y2, centerX)
    return (
      lineY > box.y - EDGE_CLEARANCE_MARGIN && lineY < box.y + box.height + EDGE_CLEARANCE_MARGIN
    )
  })
}

/** A lane above the topmost blocker or below the bottommost, whichever is the shorter detour from
 *  the straight line's own vertical position. */
function chooseLaneY(blockers: readonly Box[], y1: number, y2: number): number {
  const top = Math.min(...blockers.map((box) => box.y)) - EDGE_CLEARANCE_MARGIN
  const bottom = Math.max(...blockers.map((box) => box.y + box.height)) + EDGE_CLEARANCE_MARGIN
  const reference = (y1 + y2) / 2
  return Math.abs(top - reference) <= Math.abs(bottom - reference) ? top : bottom
}

/**
 * A y-coordinate to bend an edge's path through, for every edge whose (box-center to box-center)
 * straight line would otherwise pass behind another node's box — React Flow renders edges below
 * nodes, so an unbent skip edge sharing its row with the nodes it bypasses runs hidden underneath
 * them ("Start -> End vanishes", F10). Recomputed from the current `layout` rather than reused
 * from dagre's own routing, so it's correct after a manual drag too, not only after "Re-layout".
 */
export function computeEdgeBendLanes(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  layout: Layout
): ReadonlyMap<string, number> {
  const parentOf = loopParentMap(nodes)
  const boxes = topLevelBoxes(nodes, layout)
  const boxById = new Map(boxes.map((box) => [box.id, box]))

  const lanes = new Map<string, number>()
  for (const edge of edges) {
    const fromId = parentOf.get(edge.from) ?? edge.from
    const toId = parentOf.get(edge.to) ?? edge.to
    const fromBox = boxById.get(fromId)
    const toBox = boxById.get(toId)
    if (!fromBox || !toBox || fromId === toId) {
      continue
    }
    // Right-edge-of-source -> left-edge-of-target: assumes `direction: 'LR'` (`computeAutoLayout`
    // also accepts 'TB', with no current caller).
    const x1 = fromBox.x + fromBox.width
    const y1 = fromBox.y + fromBox.height / 2
    const x2 = toBox.x
    const y2 = toBox.y + toBox.height / 2
    const blockers = boxesInTheWay(boxes, new Set([fromId, toId]), x1, y1, x2, y2)
    if (blockers.length > 0) {
      lanes.set(edge.id, chooseLaneY(blockers, y1, y2))
    }
  }
  return lanes
}
