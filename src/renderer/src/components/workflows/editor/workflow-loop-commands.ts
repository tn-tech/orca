import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type {
  Edge,
  LoopNode,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { findCyclicEdge } from '../../../../../shared/workflows/workflow-graph-cycles'
import { WORKFLOW_LOOP_PADDING } from './workflow-auto-layout'
import type { WorkflowEditorCommandResult } from './workflow-editor-commands'

/** Node types with no port semantics of their own (data-model.md §1): safe to wrap, because
 *  forcing their outgoing edge to the Loop's `exit` port can't collide with a Router/Approval/
 *  Join's own required ports (`checkPortedNodes`/`checkJoinNodes`). */
const WRAPPABLE_NODE_TYPES: ReadonlySet<Node['type']> = new Set(['agent', 'reflection'])

function inducedEdges(edges: readonly Edge[], selected: ReadonlySet<string>): Edge[] {
  return edges.filter((edge) => selected.has(edge.from) && selected.has(edge.to))
}

/**
 * Picks entry/exit for a new Loop wrapping `nodeIds` (FR-005/FR-006, US2 AS5 "wrap in Loop").
 * If the selection already contains a cycle — the case right after a back-edge was refused —
 * the edge that closes it names entry (its target) and exit (its source), since that's exactly
 * the iterate-again edge the user was trying to draw. Otherwise entry is the selection's source
 * (no incoming edge from another selected node) and exit is its sink (no outgoing edge to
 * another selected node), each falling back to the first/last id if the selection has more than
 * one candidate (or, for entry, none — an isolated selection with edges only crossing its own
 * boundary the wrong way).
 */
function chooseLoopEntryAndExit(
  nodes: readonly Node[],
  edges: readonly Edge[],
  nodeIds: readonly string[]
): { entryNodeId: string; exitNodeId: string } {
  const selected = new Set(nodeIds)
  const selectedNodes = nodes.filter((node) => selected.has(node.id))
  const induced = inducedEdges(edges, selected)
  const cyclicEdgeId = findCyclicEdge(selectedNodes, induced)
  const closingEdge = cyclicEdgeId ? induced.find((edge) => edge.id === cyclicEdgeId) : undefined
  if (closingEdge) {
    return { entryNodeId: closingEdge.to, exitNodeId: closingEdge.from }
  }

  const hasIncoming = new Set(induced.map((edge) => edge.to))
  const hasOutgoing = new Set(induced.map((edge) => edge.from))
  const entryNodeId = nodeIds.find((id) => !hasIncoming.has(id)) ?? nodeIds[0]
  const exitNodeId =
    nodeIds.toReversed().find((id) => !hasOutgoing.has(id)) ?? nodeIds.at(-1) ?? nodeIds[0]
  return { entryNodeId, exitNodeId }
}

/** Redirects edges crossing the new Loop's boundary: an incoming edge must target the Loop's own
 *  id (or it — and the whole Loop — would never be reachable from Start, since nothing else
 *  points at it); an outgoing edge keeps its real source node but is tagged `exit` so
 *  `checkLoopNodes` treats it as the loop's exit rather than an escape. */
function reconnectEdgesForLoop(
  edges: readonly Edge[],
  selected: ReadonlySet<string>,
  loopId: string
): Edge[] {
  return edges.map((edge) => {
    const fromSelected = selected.has(edge.from)
    const toSelected = selected.has(edge.to)
    if (fromSelected && toSelected) {
      return edge
    }
    if (toSelected) {
      return { ...edge, to: loopId }
    }
    if (fromSelected) {
      return { ...edge, fromPort: 'exit' }
    }
    return edge
  })
}

function loopContainerPosition(
  layout: Workflow['layout'],
  nodeIds: readonly string[]
): { x: number; y: number } {
  const positions = nodeIds.map((id) => layout[id] ?? { x: 0, y: 0 })
  return {
    x: Math.min(...positions.map((position) => position.x)) - WORKFLOW_LOOP_PADDING,
    y: Math.min(...positions.map((position) => position.y)) - WORKFLOW_LOOP_PADDING
  }
}

/**
 * Wraps `nodeIds` in a new Loop node (FR-005/FR-006, US2 AS5): the offer shown alongside a
 * refused back-edge, but also usable directly on any selection. `maxIterations` starts at `0`
 * (the editor's "unset" sentinel — `checkLoopNodes` blocks save until the user sets a real cap,
 * US2 AS4) and `exitCondition` starts at a placeholder the user is expected to edit via
 * `LoopNodeFields`' `ConditionBuilder`.
 */
export function wrapNodesInLoopInDefinition(
  definition: Workflow,
  nodeIds: readonly string[]
): WorkflowEditorCommandResult {
  const uniqueIds = [...new Set(nodeIds)]
  const selectedNodes = uniqueIds
    .map((id) => definition.nodes.find((node) => node.id === id))
    .filter((node): node is Node => node !== undefined)

  if (uniqueIds.length === 0 || selectedNodes.length !== uniqueIds.length) {
    return {
      ok: false,
      problem: {
        code: 'workflow_editor_wrap_invalid_selection',
        message: translate(
          'auto.components.workflows.editor.workflow-loop-commands.invalidSelection',
          'Select at least one existing node to wrap in a Loop.'
        )
      }
    }
  }
  if (selectedNodes.some((node) => !WRAPPABLE_NODE_TYPES.has(node.type))) {
    return {
      ok: false,
      problem: {
        code: 'workflow_editor_wrap_unwrappable_node',
        message: translate(
          'auto.components.workflows.editor.workflow-loop-commands.unwrappableSelection',
          'Only Agent and Reflection nodes can be wrapped in a Loop.'
        )
      }
    }
  }

  const selected = new Set(uniqueIds)
  const { entryNodeId, exitNodeId } = chooseLoopEntryAndExit(
    definition.nodes,
    definition.edges,
    uniqueIds
  )
  const loopId = `loop-${createBrowserUuid()}`
  const loopNode: LoopNode = {
    id: loopId,
    type: 'loop',
    title: translate('auto.components.workflows.editor.workflow-loop-commands.loopTitle', 'Loop'),
    body: { nodeIds: uniqueIds },
    entryNodeId,
    exitNodeId,
    maxIterations: 0,
    exitCondition: { path: 'approved', op: 'truthy' },
    onCapReached: 'fail'
  }

  return {
    ok: true,
    definition: {
      ...definition,
      nodes: [...definition.nodes, loopNode],
      edges: reconnectEdgesForLoop(definition.edges, selected, loopId),
      layout: {
        ...definition.layout,
        [loopId]: loopContainerPosition(definition.layout, uniqueIds)
      }
    }
  }
}
