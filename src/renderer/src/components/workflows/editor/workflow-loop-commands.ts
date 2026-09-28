import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type {
  Edge,
  LoopNode,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { findCyclicEdge } from '../../../../../shared/workflows/workflow-graph-cycles'
import {
  computeLoopContainerBounds,
  measureWorkflowNodeSize,
  WORKFLOW_LOOP_PADDING
} from './workflow-auto-layout'
import type { WorkflowEditorCommandResult, WorkflowEditorProblem } from './workflow-editor-commands'
import { nudgeOverlappingSiblings, type Box } from './workflow-loop-neighbour-nudge'

/** Node types with no port semantics of their own (data-model.md §1): safe to wrap, because
 *  forcing their outgoing edge to the Loop's `exit` port can't collide with a Router/Approval/
 *  Join's own required ports (`checkPortedNodes`/`checkJoinNodes`). */
const WRAPPABLE_NODE_TYPES: ReadonlySet<Node['type']> = new Set(['agent', 'reflection'])

function inducedEdges(edges: readonly Edge[], selected: ReadonlySet<string>): Edge[] {
  return edges.filter((edge) => selected.has(edge.from) && selected.has(edge.to))
}

function refusal(code: string, message: string): WorkflowEditorCommandResult {
  return { ok: false, problem: { code, message } }
}

/** True iff every selected node is reachable from every other, walking induced edges as
 *  undirected (a Loop body must be one cohesive group, not several unrelated clusters). */
function isConnectedSelection(nodeIds: readonly string[], induced: readonly Edge[]): boolean {
  const first = nodeIds[0]
  if (first === undefined) {
    return true
  }
  const adjacency = new Map<string, Set<string>>(nodeIds.map((id) => [id, new Set<string>()]))
  for (const edge of induced) {
    adjacency.get(edge.from)?.add(edge.to)
    adjacency.get(edge.to)?.add(edge.from)
  }
  const visited = new Set<string>([first])
  const queue = [first]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) {
      break
    }
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  return visited.size === nodeIds.length
}

/**
 * Fallback entry/exit when the selection's own external edges don't already pin one down (no
 * edge in from outside for entry, or none out to outside for exit) — e.g. a selection with no
 * connections to the rest of the graph yet. If the selection already contains a cycle — the case
 * right after a back-edge was refused, when the caller wraps exactly that edge's two endpoints —
 * the edge that closes it names entry (its target) and exit (its source). Otherwise entry is the
 * selection's own source (no incoming edge from another selected node) and exit is its sink (no
 * outgoing edge to another selected node).
 */
function fallbackEntryExit(
  nodes: readonly Node[],
  nodeIds: readonly string[],
  induced: Edge[]
): { entryNodeId: string; exitNodeId: string } {
  const selected = new Set(nodeIds)
  const selectedNodes = nodes.filter((node) => selected.has(node.id))
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

/**
 * Validates the selection has exactly one entry and one exit before anything is mutated (review
 * round 1: a fan-in/fan-out selection previously collapsed distinct external edges onto the same
 * Loop id, silently rewiring an edge that fed a different node than the one it looked like it
 * fed, and could strand a node that had no other path in). Returns the resolved entry/exit, or a
 * refusal naming which constraint failed.
 */
function resolveLoopEntryExit(
  definition: Workflow,
  nodeIds: readonly string[]
):
  | { ok: true; entryNodeId: string; exitNodeId: string }
  | { ok: false; problem: WorkflowEditorProblem } {
  const selected = new Set(nodeIds)
  const induced = inducedEdges(definition.edges, selected)

  if (!isConnectedSelection(nodeIds, induced)) {
    return {
      ok: false,
      problem: {
        code: 'workflow_editor_wrap_disconnected_selection',
        message: translate(
          'auto.components.workflows.editor.workflow-loop-commands.disconnectedSelection',
          'The selected nodes must form a single connected group to wrap in a Loop.'
        )
      }
    }
  }

  const incomingTargets = new Set(
    definition.edges
      .filter((edge) => selected.has(edge.to) && !selected.has(edge.from))
      .map((edge) => edge.to)
  )
  if (incomingTargets.size > 1) {
    return {
      ok: false,
      problem: {
        code: 'workflow_editor_wrap_multiple_entries',
        message: translate(
          'auto.components.workflows.editor.workflow-loop-commands.multipleEntries',
          'These nodes have more than one incoming connection from outside the selection; a Loop can only have one entry point.'
        )
      }
    }
  }

  const outgoingSources = new Set(
    definition.edges
      .filter((edge) => selected.has(edge.from) && !selected.has(edge.to))
      .map((edge) => edge.from)
  )
  if (outgoingSources.size > 1) {
    return {
      ok: false,
      problem: {
        code: 'workflow_editor_wrap_multiple_exits',
        message: translate(
          'auto.components.workflows.editor.workflow-loop-commands.multipleExits',
          'These nodes have more than one outgoing connection to outside the selection; a Loop can only have one exit point.'
        )
      }
    }
  }

  const fallback = fallbackEntryExit(definition.nodes, nodeIds, induced)
  const [singleIncomingTarget] = incomingTargets
  const [singleOutgoingSource] = outgoingSources
  return {
    ok: true,
    entryNodeId: singleIncomingTarget ?? fallback.entryNodeId,
    exitNodeId: singleOutgoingSource ?? fallback.exitNodeId
  }
}

/** Redirects edges crossing the new Loop's boundary: an incoming edge must target the Loop's own
 *  id (or it — and the whole Loop — would never be reachable from Start, since nothing else
 *  points at it); an outgoing edge keeps its real source node but is tagged `exit` so
 *  `checkLoopNodes` treats it as the loop's exit rather than an escape. Safe now that
 *  `resolveLoopEntryExit` has already confirmed every such edge shares the same entry/exit. */
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
 * refused back-edge, but also usable directly on any selection. Refuses without mutating
 * anything when the selection isn't a single connected group with exactly one entry and one exit
 * (`resolveLoopEntryExit`). `maxIterations` starts at `0` (the editor's "unset" sentinel —
 * `checkLoopNodes` blocks save until the user sets a real cap, US2 AS4) and `exitCondition`
 * starts at a placeholder the user is expected to edit via `LoopNodeFields`' `ConditionBuilder`.
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
    return refusal(
      'workflow_editor_wrap_invalid_selection',
      translate(
        'auto.components.workflows.editor.workflow-loop-commands.invalidSelection',
        'Select at least one existing node to wrap in a Loop.'
      )
    )
  }
  if (selectedNodes.some((node) => !WRAPPABLE_NODE_TYPES.has(node.type))) {
    return refusal(
      'workflow_editor_wrap_unwrappable_node',
      translate(
        'auto.components.workflows.editor.workflow-loop-commands.unwrappableSelection',
        'Only Agent and Reflection nodes can be wrapped in a Loop.'
      )
    )
  }

  const resolved = resolveLoopEntryExit(definition, uniqueIds)
  if (!resolved.ok) {
    return { ok: false, problem: resolved.problem }
  }
  const { entryNodeId, exitNodeId } = resolved

  const selected = new Set(uniqueIds)
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

  const loopPosition = loopContainerPosition(definition.layout, uniqueIds)
  const wrappedBoxes = selectedNodes.map((node) => ({
    ...(definition.layout[node.id] ?? { x: 0, y: 0 }),
    ...measureWorkflowNodeSize(node)
  }))
  const loopBox: Box = {
    ...loopPosition,
    ...computeLoopContainerBounds(loopPosition, wrappedBoxes)
  }

  return {
    ok: true,
    definition: {
      ...definition,
      nodes: [...definition.nodes, loopNode],
      edges: reconnectEdgesForLoop(definition.edges, selected, loopId),
      layout: {
        ...nudgeOverlappingSiblings(definition, selected, loopBox),
        [loopId]: loopPosition
      }
    }
  }
}
