import dagre from '@dagrejs/dagre'
import type {
  Edge as WorkflowEdge,
  Layout,
  Node as WorkflowNode
} from '../../../../../shared/workflows/workflow-definition-types'

/** Node box dagre lays out around; also the size node components render at (FR-010, T065). */
export const WORKFLOW_NODE_WIDTH = 220
export const WORKFLOW_NODE_HEIGHT = 64

/** Margin between a Loop container's edge and its body nodes' bounding box (T078). */
export const WORKFLOW_LOOP_PADDING = 40

const RANK_SEPARATION = 96
const NODE_SEPARATION = 56

export type AutoLayoutOptions = {
  /** Positions restored after layout instead of the dagre-computed one (FR-010: manual drags). */
  pinned?: Readonly<Record<string, { x: number; y: number }>>
  direction?: 'LR' | 'TB'
}

/**
 * Lays out every node with dagre (left-to-right by default), then overlays `pinned` positions
 * so a manually dragged node never moves under "Re-layout" (FR-010, controller ruling on U23).
 * Dagre's coordinates are box centers; this converts to the top-left origin React Flow expects.
 */
export function computeAutoLayout(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  options: AutoLayoutOptions = {}
): Layout {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({
    rankdir: options.direction ?? 'LR',
    nodesep: NODE_SEPARATION,
    ranksep: RANK_SEPARATION
  })
  graph.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    graph.setNode(node.id, { width: WORKFLOW_NODE_WIDTH, height: WORKFLOW_NODE_HEIGHT })
  }
  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const edge of edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
      graph.setEdge(edge.from, edge.to)
    }
  }

  dagre.layout(graph)

  const layout: Layout = {}
  for (const node of nodes) {
    const pinnedPosition = options.pinned?.[node.id]
    if (pinnedPosition) {
      layout[node.id] = pinnedPosition
      continue
    }
    const positioned = graph.node(node.id)
    layout[node.id] = {
      x: (positioned?.x ?? 0) - WORKFLOW_NODE_WIDTH / 2,
      y: (positioned?.y ?? 0) - WORKFLOW_NODE_HEIGHT / 2
    }
  }
  return layout
}

/**
 * A Loop container's rendered size: the smallest box (in absolute layout coordinates, anchored
 * at `containerPosition`) that fits every body node's box plus `WORKFLOW_LOOP_PADDING` on all
 * sides (T078 container rendering). Body nodes drag-clamped to `extent: 'parent'` in
 * `WorkflowCanvas.tsx` can never end up outside this box once it's computed.
 */
export function computeLoopContainerBounds(
  containerPosition: { x: number; y: number },
  bodyNodePositions: readonly { x: number; y: number }[]
): { width: number; height: number } {
  if (bodyNodePositions.length === 0) {
    return {
      width: WORKFLOW_NODE_WIDTH + WORKFLOW_LOOP_PADDING * 2,
      height: WORKFLOW_NODE_HEIGHT + WORKFLOW_LOOP_PADDING * 2
    }
  }
  const maxX = Math.max(...bodyNodePositions.map((position) => position.x + WORKFLOW_NODE_WIDTH))
  const maxY = Math.max(...bodyNodePositions.map((position) => position.y + WORKFLOW_NODE_HEIGHT))
  return {
    width: maxX - containerPosition.x + WORKFLOW_LOOP_PADDING,
    height: maxY - containerPosition.y + WORKFLOW_LOOP_PADDING
  }
}
