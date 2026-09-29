import { translate } from '@/i18n/i18n'
import type {
  Edge,
  LoopNode,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import {
  computeLoopContainerBounds,
  measureWorkflowNodeSize,
  WORKFLOW_LOOP_PADDING
} from './workflow-auto-layout'
import type { WorkflowEditorCommandResult } from './workflow-editor-commands'
import { nudgeOverlappingSiblings } from './workflow-loop-neighbour-nudge'

/** Kinds the engine runs inside a Loop body (workflow-loop-unrolling.ts): no nested Loops, and
 *  Start/End only make sense on the outer graph. */
export const LOOP_BODY_NODE_TYPES: ReadonlySet<Node['type']> = new Set([
  'agent',
  'reflection',
  'router',
  'join',
  'approval'
])

export type LoopEdit =
  | { kind: 'set-entry'; nodeId: string }
  | { kind: 'set-exit'; nodeId: string }
  | { kind: 'add-member'; nodeId: string }
  | { kind: 'remove-member'; nodeId: string }

function refusal(code: string, message: string): WorkflowEditorCommandResult {
  return { ok: false, problem: { code, message } }
}

function notMemberRefusal(): WorkflowEditorCommandResult {
  return refusal(
    'workflow_editor_loop_not_member',
    translate(
      'auto.components.workflows.editor.workflow-loop-membership-commands.notMember',
      'Choose a node that is inside this Loop.'
    )
  )
}

function isWiredToLoop(edges: readonly Edge[], loopId: string, nodeId: string): boolean {
  return edges.some(
    (edge) =>
      (edge.from === loopId && edge.to === nodeId) || (edge.from === nodeId && edge.to === loopId)
  )
}

/** Nodes that "Add to Loop" may offer for `loopId`. */
export function loopMemberCandidates(definition: Workflow, loopId: string): Node[] {
  const owned = new Set(
    definition.nodes.flatMap((node) => (node.type === 'loop' ? node.body.nodeIds : []))
  )
  return definition.nodes.filter(
    (node) =>
      LOOP_BODY_NODE_TYPES.has(node.type) &&
      !owned.has(node.id) &&
      !isWiredToLoop(definition.edges, loopId, node.id)
  )
}

/** Body-sourced `exit` edges move onto the Loop itself, so they survive any later exit change and
 *  never sit on an Approval/Router whose outgoing edges must be its own options. */
function rehomeExitEdges(
  edges: readonly Edge[],
  loopId: string,
  fromIds: ReadonlySet<string>
): Edge[] {
  const seen = new Set<string>()
  return edges.flatMap((edge) => {
    const next =
      edge.fromPort === 'exit' && fromIds.has(edge.from) ? { ...edge, from: loopId } : edge
    if (next.fromPort !== 'exit' || next.from !== loopId) {
      return [next]
    }
    const key = `${next.to}\u0000${next.condition ? JSON.stringify(next.condition) : ''}`
    if (seen.has(key)) {
      return []
    }
    seen.add(key)
    return [next]
  })
}

function bodyBoxes(definition: Workflow, nodeIds: readonly string[]) {
  return nodeIds.flatMap((id) => {
    const node = definition.nodes.find((candidate) => candidate.id === id)
    return node
      ? [{ ...(definition.layout[id] ?? { x: 0, y: 0 }), ...measureWorkflowNodeSize(node) }]
      : []
  })
}

function addMember(
  definition: Workflow,
  loop: LoopNode,
  nodeId: string
): WorkflowEditorCommandResult {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId)
  if (
    !node ||
    !loopMemberCandidates(definition, loop.id).some((candidate) => candidate.id === nodeId)
  ) {
    return refusal(
      'workflow_editor_loop_add_refused',
      translate(
        'auto.components.workflows.editor.workflow-loop-membership-commands.addRefused',
        'Only an Agent, Reflection, Router, Join or Approval node that is not in another Loop and not connected to this Loop can be added.'
      )
    )
  }
  const members = bodyBoxes(definition, loop.body.nodeIds)
  const loopPosition = definition.layout[loop.id] ?? { x: 0, y: 0 }
  const position = {
    x: Math.max(...members.map((box) => box.x + box.width)) + WORKFLOW_LOOP_PADDING,
    y: Math.min(...members.map((box) => box.y))
  }
  const nodeIds = [...loop.body.nodeIds, nodeId]
  const placed: Workflow = {
    ...definition,
    nodes: definition.nodes.map((candidate) =>
      candidate.id === loop.id ? { ...loop, body: { nodeIds } } : candidate
    ),
    layout: { ...definition.layout, [nodeId]: position }
  }
  const loopBox = {
    ...loopPosition,
    ...computeLoopContainerBounds(loopPosition, bodyBoxes(placed, nodeIds))
  }
  return {
    ok: true,
    definition: { ...placed, layout: nudgeOverlappingSiblings(placed, new Set([loop.id]), loopBox) }
  }
}

function removeMember(
  definition: Workflow,
  loop: LoopNode,
  nodeId: string
): WorkflowEditorCommandResult {
  if (!loop.body.nodeIds.includes(nodeId)) {
    return notMemberRefusal()
  }
  if (nodeId === loop.entryNodeId || nodeId === loop.exitNodeId) {
    return refusal(
      'workflow_editor_loop_remove_endpoint',
      translate(
        'auto.components.workflows.editor.workflow-loop-membership-commands.removeEndpoint',
        'Choose a different entry or exit node before removing this one from the Loop.'
      )
    )
  }
  const nodeIds = loop.body.nodeIds.filter((id) => id !== nodeId)
  const loopPosition = definition.layout[loop.id] ?? { x: 0, y: 0 }
  const bounds = computeLoopContainerBounds(loopPosition, bodyBoxes(definition, nodeIds))
  const current = definition.layout[nodeId] ?? loopPosition
  return {
    ok: true,
    definition: {
      ...definition,
      nodes: definition.nodes.map((candidate) =>
        candidate.id === loop.id ? { ...loop, body: { nodeIds } } : candidate
      ),
      edges: rehomeExitEdges(definition.edges, loop.id, new Set([nodeId])),
      layout: {
        ...definition.layout,
        [nodeId]: { x: loopPosition.x + bounds.width + WORKFLOW_LOOP_PADDING, y: current.y }
      }
    }
  }
}

/** F11: repoints a Loop's entry/exit or changes its body. Refuses without mutating anything; edges
 *  the edit leaves invalid (e.g. a new member's edge out of the body) are for validation to flag. */
export function editLoopInDefinition(
  definition: Workflow,
  loopId: string,
  edit: LoopEdit
): WorkflowEditorCommandResult {
  const loop = definition.nodes.find((node) => node.id === loopId)
  if (!loop || loop.type !== 'loop') {
    return refusal(
      'workflow_editor_loop_not_found',
      translate(
        'auto.components.workflows.editor.workflow-loop-membership-commands.notALoop',
        'Select a Loop node to edit.'
      )
    )
  }
  switch (edit.kind) {
    case 'add-member':
      return addMember(definition, loop, edit.nodeId)
    case 'remove-member':
      return removeMember(definition, loop, edit.nodeId)
    case 'set-entry':
    case 'set-exit': {
      if (!loop.body.nodeIds.includes(edit.nodeId)) {
        return notMemberRefusal()
      }
      const next: LoopNode =
        edit.kind === 'set-entry'
          ? { ...loop, entryNodeId: edit.nodeId }
          : { ...loop, exitNodeId: edit.nodeId }
      return {
        ok: true,
        definition: {
          ...definition,
          nodes: definition.nodes.map((node) => (node.id === loopId ? next : node)),
          edges:
            edit.kind === 'set-exit'
              ? rehomeExitEdges(definition.edges, loopId, new Set(loop.body.nodeIds))
              : definition.edges
        }
      }
    }
  }
}
