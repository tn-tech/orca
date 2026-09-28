import dagre from '@dagrejs/dagre'
import type {
  Edge as WorkflowEdge,
  Layout,
  Node as WorkflowNode
} from '../../../../../shared/workflows/workflow-definition-types'

/** Base node box: the two-row card (icon+title row, one info row) every non-Loop kind renders at
 *  minimum. Also the size node components render at when they have nothing extra to show
 *  (FR-010, T065). */
export const WORKFLOW_NODE_WIDTH = 220
export const WORKFLOW_NODE_HEIGHT = 64

/** Margin between a Loop container's edge and its body nodes' bounding box (T078). */
export const WORKFLOW_LOOP_PADDING = 40

const RANK_SEPARATION = 96
const NODE_SEPARATION = 56

/** One more info row (a label + the `gap-1` above it) beyond the base two-row card. Doesn't cover
 *  the run-view-only `workspaceLabel` row (`AgentNode.tsx`/`RouterNode.tsx`/`ReflectionNode.tsx`):
 *  that row exists only on a live attempt, not on the persisted `Node` this function reads, so a
 *  running node's card can render a little taller than this reserves — `minHeight` on those
 *  components (not an exact `height`) keeps that a harmless bit of extra whitespace, not a
 *  hidden-edge regression. */
const EXTRA_INFO_ROW_HEIGHT = 18
/**
 * One Router/Approval choice row's full vertical pitch: `<li>` is `py-1` (8) + a 1px border on
 * each side (2) + a `text-xs` line (16) = 26px, and the list (`mt-1 space-y-1`) adds a 4px gap
 * before every row except the first. The list's *total* height for N rows is exactly linear —
 * `4 + 26N + 4(N-1) = 30N` (the leading `mt-1` offsets the one-fewer-gap) — so 30px/row with no
 * separate constant reproduces the real total for every N.
 */
const CHOICE_ROW_HEIGHT = 30

export type MeasuredNodeSize = { width: number; height: number }

export type AutoLayoutOptions = {
  /** Positions restored after layout instead of the dagre-computed one (FR-010: manual drags). */
  pinned?: Readonly<Record<string, { x: number; y: number }>>
  /** The layout as it stood before this Re-layout run (`Workflow.layout`, not just `pinned`'s
   *  subset). Anchors a pinned Loop-body node to its Loop's pre-layout position, so a dragged
   *  body node moves with an unpinned Loop instead of staying at a stale absolute spot. */
  currentLayout?: Layout
  /** React Flow's real measured size for a node, when one has been painted. Checked before
   *  `measureWorkflowNodeSize` for every non-Loop kind; a Loop's own box is still always derived
   *  from its body (see below). */
  measuredSizes?: ReadonlyMap<string, MeasuredNodeSize>
  direction?: 'LR' | 'TB'
}

/**
 * A node's real rendered box, per kind (F10 root cause: an `AgentNode` with `overrides.model` set
 * renders ~79px against the fixed 64px layout box `workflow-auto-layout.ts` used everywhere, so
 * dagre never reserved room for it and a bypass edge ran straight underneath — the "Start -> End
 * vanishes" report). Every node component whose content can grow past the base card
 * (`AgentNode`/`RouterNode`/`ApprovalNode`) calls this for its own box instead of a bare constant,
 * so the layout box and the rendered box can't drift apart again. This is the *estimate* —
 * `computeAutoLayout` prefers `options.measuredSizes` over it whenever one's available. A Loop's
 * own box isn't measured here — `computeLoopContainerBounds` derives it from the body's own
 * layout.
 */
export function measureWorkflowNodeSize(node: WorkflowNode): { width: number; height: number } {
  const width = WORKFLOW_NODE_WIDTH
  switch (node.type) {
    case 'agent':
      return {
        width,
        height: WORKFLOW_NODE_HEIGHT + (node.overrides?.model ? EXTRA_INFO_ROW_HEIGHT : 0)
      }
    case 'router':
      return { width, height: WORKFLOW_NODE_HEIGHT + node.choices.length * CHOICE_ROW_HEIGHT }
    case 'approval':
      return {
        width,
        height:
          WORKFLOW_NODE_HEIGHT +
          EXTRA_INFO_ROW_HEIGHT + // the timeout row, always shown alongside the question
          node.options.length * CHOICE_ROW_HEIGHT
      }
    // These all render the base two-row card (or, for 'loop', aren't sized here at all —
    // `computeLoopContainerBounds` derives that box from the body's own layout).
    case 'start':
    case 'end':
    case 'join':
    case 'reflection':
    case 'loop':
      return { width, height: WORKFLOW_NODE_HEIGHT }
  }
}

/** Body-node id -> owning Loop id. Shared by this module's hierarchical layout pass, edge
 *  routing (`workflow-edge-routing.ts`), and `WorkflowCanvas.tsx`'s React Flow child nesting. */
export function loopParentMap(nodes: readonly WorkflowNode[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of nodes) {
    if (node.type === 'loop') {
      for (const childId of node.body.nodeIds) {
        map.set(childId, node.id)
      }
    }
  }
  return map
}

/**
 * Lays out every node with dagre (left-to-right by default), then overlays `pinned` positions
 * so a manually dragged node never moves under "Re-layout" (FR-010, controller ruling on U23).
 * Dagre's coordinates are box centers; this converts to the top-left origin React Flow expects.
 *
 * A Loop's body is laid out first, in its own nested pass (this function calling itself over just
 * the body nodes/edges) — the loop's real footprint, not a fixed node box, is what the top-level
 * graph then reserves space for. Previously the body nodes were fed into the same flat dagre graph
 * as ordinary top-level nodes, so the container box computed post-hoc around wherever dagre had
 * put them (usually driven by different edges than the ones that placed the Loop node itself) —
 * landing anywhere, typically overlapping an unrelated sibling (F10: "Loop containers overlap
 * neighbours").
 */
export function computeAutoLayout(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  options: AutoLayoutOptions = {}
): Layout {
  const direction = options.direction ?? 'LR'
  const pinned = options.pinned ?? {}
  const currentLayout = options.currentLayout ?? {}
  const measuredSizes = options.measuredSizes
  const parentOf = loopParentMap(nodes)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const topLevelNodes = nodes.filter((node) => !parentOf.has(node.id))

  const sizeOf = (node: WorkflowNode): { width: number; height: number } =>
    measuredSizes?.get(node.id) ?? measureWorkflowNodeSize(node)

  const loopBounds = new Map<string, { width: number; height: number }>()
  const loopBodyLayout = new Map<string, Layout>()
  for (const node of topLevelNodes) {
    if (node.type !== 'loop') {
      continue
    }
    const bodyNodes = node.body.nodeIds
      .map((id) => nodeById.get(id))
      .filter((bodyNode): bodyNode is WorkflowNode => bodyNode !== undefined)
    const bodyIds = new Set(bodyNodes.map((bodyNode) => bodyNode.id))
    const internalEdges = edges.filter((edge) => bodyIds.has(edge.from) && bodyIds.has(edge.to))
    // Unpinned pass over every body node (pinned or not) — a pinned body node's dagre-computed
    // position here is only ever used to decide where its *unpinned* siblings land; its own entry
    // gets overwritten below with its true position, anchored to this Loop.
    const nested = computeAutoLayout(bodyNodes, internalEdges, { direction, measuredSizes })
    const xs = Object.values(nested).map((position) => position.x)
    const ys = Object.values(nested).map((position) => position.y)
    const originX = xs.length > 0 ? Math.min(...xs) : 0
    const originY = ys.length > 0 ? Math.min(...ys) : 0
    const normalized: Layout = {}
    for (const [id, position] of Object.entries(nested)) {
      normalized[id] = {
        x: position.x - originX + WORKFLOW_LOOP_PADDING,
        y: position.y - originY + WORKFLOW_LOOP_PADDING
      }
    }
    // A pinned body node's `pinned[id]` is an absolute canvas position captured before this
    // Re-layout — stale once dagre moves the Loop. Re-anchor it as an offset from the Loop's
    // *pre*-layout position instead, in the same loop-local frame `normalized` already uses, so
    // the final merge below can treat every body node the same way: new Loop position + offset.
    const loopPreviousPosition = currentLayout[node.id] ?? { x: 0, y: 0 }
    for (const bodyNode of bodyNodes) {
      const pinnedAbsolute = pinned[bodyNode.id]
      if (pinnedAbsolute) {
        normalized[bodyNode.id] = {
          x: pinnedAbsolute.x - loopPreviousPosition.x,
          y: pinnedAbsolute.y - loopPreviousPosition.y
        }
      }
    }
    loopBounds.set(
      node.id,
      computeLoopContainerBounds(
        { x: 0, y: 0 },
        bodyNodes.map((bodyNode) => ({
          ...normalized[bodyNode.id],
          ...sizeOf(bodyNode)
        }))
      )
    )
    loopBodyLayout.set(node.id, normalized)
  }

  const sizeOfTopLevel = (node: WorkflowNode): { width: number; height: number } =>
    node.type === 'loop'
      ? (loopBounds.get(node.id) ?? { width: WORKFLOW_NODE_WIDTH, height: WORKFLOW_NODE_HEIGHT })
      : sizeOf(node)

  const graph = new dagre.graphlib.Graph()
  graph.setGraph({
    rankdir: direction,
    nodesep: NODE_SEPARATION,
    ranksep: RANK_SEPARATION
  })
  graph.setDefaultEdgeLabel(() => ({}))

  for (const node of topLevelNodes) {
    graph.setNode(node.id, sizeOfTopLevel(node))
  }
  const topLevelIds = new Set(topLevelNodes.map((node) => node.id))
  for (const edge of edges) {
    const from = parentOf.get(edge.from) ?? edge.from
    const to = parentOf.get(edge.to) ?? edge.to
    // A purely internal Loop-body edge maps both ends to the same loop id — dagre rejects a
    // self-edge, and it carries no information the nested body pass above didn't already use.
    if (from !== to && topLevelIds.has(from) && topLevelIds.has(to)) {
      graph.setEdge(from, to)
    }
  }

  dagre.layout(graph)

  const layout: Layout = {}
  for (const node of topLevelNodes) {
    const pinnedPosition = pinned[node.id]
    if (pinnedPosition) {
      layout[node.id] = pinnedPosition
      continue
    }
    const size = sizeOfTopLevel(node)
    const positioned = graph.node(node.id)
    layout[node.id] = {
      x: (positioned?.x ?? 0) - size.width / 2,
      y: (positioned?.y ?? 0) - size.height / 2
    }
  }
  for (const [loopId, bodyLayout] of loopBodyLayout) {
    const origin = layout[loopId] ?? { x: 0, y: 0 }
    for (const [id, relative] of Object.entries(bodyLayout)) {
      // `relative` is already this Loop's new-position-relative offset, for both a pinned body
      // node (re-anchored above) and an unpinned one — using `pinned[id]` directly here instead
      // would restore its stale pre-layout *absolute* position, orphaned from the Loop's new spot.
      layout[id] = { x: origin.x + relative.x, y: origin.y + relative.y }
    }
  }
  return layout
}

/**
 * A Loop container's rendered size: the smallest box (in absolute layout coordinates, anchored
 * at `containerPosition`) that fits every body node's own box (its measured `width`/`height`, or
 * the base card size when not given) plus `WORKFLOW_LOOP_PADDING` on all sides (T078 container
 * rendering). Body nodes drag-clamped to `extent: 'parent'` in `WorkflowCanvas.tsx` can never end
 * up outside this box once it's computed.
 */
export function computeLoopContainerBounds(
  containerPosition: { x: number; y: number },
  bodyNodePositions: readonly { x: number; y: number; width?: number; height?: number }[]
): { width: number; height: number } {
  if (bodyNodePositions.length === 0) {
    return {
      width: WORKFLOW_NODE_WIDTH + WORKFLOW_LOOP_PADDING * 2,
      height: WORKFLOW_NODE_HEIGHT + WORKFLOW_LOOP_PADDING * 2
    }
  }
  const maxX = Math.max(
    ...bodyNodePositions.map((position) => position.x + (position.width ?? WORKFLOW_NODE_WIDTH))
  )
  const maxY = Math.max(
    ...bodyNodePositions.map((position) => position.y + (position.height ?? WORKFLOW_NODE_HEIGHT))
  )
  return {
    width: maxX - containerPosition.x + WORKFLOW_LOOP_PADDING,
    height: maxY - containerPosition.y + WORKFLOW_LOOP_PADDING
  }
}
