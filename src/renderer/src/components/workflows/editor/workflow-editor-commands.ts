import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type {
  Condition,
  Node,
  Role,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { findCyclicEdge } from '../../../../../shared/workflows/workflow-graph-cycles'

/** Only Agent/Router/Reflection nodes dispatch through a role (workflow-graph-validation.ts). */
function nodeOwnRoleId(node: Node): string | undefined {
  return node.type === 'agent' || node.type === 'router' || node.type === 'reflection'
    ? node.roleId
    : undefined
}

/** Same shape as `GraphValidationContext.agentSupportsModel` (src/shared), reused for FR-004. */
export type WorkflowEditorCommandContext = {
  agentSupportsModel: (agent: string) => boolean
}

export type WorkflowEditorProblem = {
  code: string
  message: string
  /** Present on `graph_cycle`: the two nodes a "Wrap in Loop" action would wrap (FR-005, US2
   *  AS5) — the connection's own endpoints, which is also `chooseLoopEntryAndExit`'s fallback
   *  entry/exit pick for a two-node selection. */
  wrapNodeIds?: string[]
}

export type WorkflowEditorCommandResult =
  | { ok: true; definition: Workflow }
  | { ok: false; problem: WorkflowEditorProblem }

/** Appends a node at `position`; the node is not "manually positioned" (may still auto-layout). */
export function addNodeToDefinition(
  definition: Workflow,
  node: Node,
  position: { x: number; y: number }
): Workflow {
  return {
    ...definition,
    nodes: [...definition.nodes, node],
    layout: { ...definition.layout, [node.id]: position }
  }
}

/** Creates an edge; refuses when it would close a cycle outside a Loop body (FR-005). */
export function connectNodesInDefinition(
  definition: Workflow,
  input: { from: string; to: string; fromPort?: string }
): WorkflowEditorCommandResult {
  const edge = {
    id: `edge-${createBrowserUuid()}`,
    from: input.from,
    to: input.to,
    ...(input.fromPort === undefined ? {} : { fromPort: input.fromPort })
  }
  const nextEdges = [...definition.edges, edge]
  if (findCyclicEdge(definition.nodes, nextEdges) !== undefined) {
    return {
      ok: false,
      problem: {
        code: 'graph_cycle',
        message: translate(
          'auto.components.workflows.editor.workflow-editor-commands.cycleRefused',
          'This connection would create a cycle outside a Loop node. Wrap the selected nodes in a Loop instead.'
        ),
        wrapNodeIds: [input.from, input.to]
      }
    }
  }
  return { ok: true, definition: { ...definition, edges: nextEdges } }
}

/** Removes nodes/edges by id, plus any edge touching a removed node, plus their layout entries.
 *  Removing a Loop node also removes its body (F4): the editor has no way to pull a node back out
 *  of a Loop, so leaving the body behind would just orphan it. */
export function deleteElementsFromDefinition(
  definition: Workflow,
  target: { nodeIds?: readonly string[]; edgeIds?: readonly string[] }
): Workflow {
  const requestedNodeIds = new Set(target.nodeIds ?? [])
  const nodeIdsToRemove = new Set(requestedNodeIds)
  for (const node of definition.nodes) {
    if (node.type === 'loop' && requestedNodeIds.has(node.id)) {
      for (const bodyNodeId of node.body.nodeIds) {
        nodeIdsToRemove.add(bodyNodeId)
      }
    }
  }
  const edgeIdsToRemove = new Set(target.edgeIds ?? [])
  const nodes = definition.nodes.filter((node) => !nodeIdsToRemove.has(node.id))
  const edges = definition.edges.filter(
    (edge) =>
      !edgeIdsToRemove.has(edge.id) &&
      !nodeIdsToRemove.has(edge.from) &&
      !nodeIdsToRemove.has(edge.to)
  )
  const layout = Object.fromEntries(
    Object.entries(definition.layout).filter(([nodeId]) => !nodeIdsToRemove.has(nodeId))
  )
  return { ...definition, nodes, edges, layout }
}

/** Replaces a node by id (caller supplies the full, already-edited node). */
export function updateNodeInDefinition(
  definition: Workflow,
  updatedNode: Node
): WorkflowEditorCommandResult {
  if (!definition.nodes.some((node) => node.id === updatedNode.id)) {
    return {
      ok: false,
      problem: {
        code: 'workflow_editor_node_not_found',
        message: translate(
          'auto.components.workflows.editor.workflow-editor-commands.nodeNotFound',
          'Node "{{id}}" was not found in the workflow.',
          { id: updatedNode.id }
        )
      }
    }
  }
  return {
    ok: true,
    definition: {
      ...definition,
      nodes: definition.nodes.map((node) => (node.id === updatedNode.id ? updatedNode : node))
    }
  }
}

/** Sets (or clears) the condition on an existing edge (FR-008, edited via ConditionBuilder). */
export function updateEdgeConditionInDefinition(
  definition: Workflow,
  edgeId: string,
  condition: Condition | undefined
): WorkflowEditorCommandResult {
  if (!definition.edges.some((edge) => edge.id === edgeId)) {
    return {
      ok: false,
      problem: {
        code: 'workflow_editor_edge_not_found',
        message: translate(
          'auto.components.workflows.editor.workflow-editor-commands.edgeNotFound',
          'Edge "{{id}}" was not found in the workflow.',
          { id: edgeId }
        )
      }
    }
  }
  return {
    ok: true,
    definition: {
      ...definition,
      edges: definition.edges.map((edge) => (edge.id === edgeId ? { ...edge, condition } : edge))
    }
  }
}

/** FR-004: model/effort controls are enabled only once an agent with a model catalog is chosen. */
export function getModelEffortAvailability(
  agent: string | undefined,
  context: WorkflowEditorCommandContext
): { enabled: boolean; reason?: string } {
  if (!agent) {
    return {
      enabled: false,
      reason: translate(
        'auto.components.workflows.editor.workflow-editor-commands.noAgentSelected',
        'Select an agent before choosing a model or reasoning effort.'
      )
    }
  }
  if (!context.agentSupportsModel(agent)) {
    return {
      enabled: false,
      reason: translate(
        'auto.components.workflows.editor.workflow-editor-commands.noModelCatalog',
        '"{{agent}}" has no model catalog, so model and reasoning effort cannot be overridden.',
        { agent }
      )
    }
  }
  return { enabled: true }
}

/** Creates or replaces a role by id (US4 AS1: the workflow-level roles list, edited from
 *  `roles/RolesPanel.tsx`). `roleId` is the stable map key; `role.id` is expected to match it. */
export function setRoleInDefinition(definition: Workflow, roleId: string, role: Role): Workflow {
  return { ...definition, roles: { ...definition.roles, [roleId]: role } }
}

/** Removes a role by id and clears it from every node that referenced it, so no node is left
 *  pointing at a role no longer in `definition.roles`. */
export function removeRoleFromDefinition(definition: Workflow, roleId: string): Workflow {
  const { [roleId]: _removed, ...roles } = definition.roles
  const nodes = definition.nodes.map((node) => {
    if (nodeOwnRoleId(node) !== roleId) {
      return node
    }
    // Why not a cast: `nodeOwnRoleId` already narrowed `node` to a role-dispatching type, but
    // that narrowing doesn't survive being returned through the plain `Node` union above — the
    // per-type spread below re-establishes it without asserting anything.
    switch (node.type) {
      case 'agent':
      case 'router':
      case 'reflection':
        return { ...node, roleId: undefined }
      case 'start':
      case 'end':
      case 'loop':
      case 'join':
      case 'approval':
        return node
    }
  })
  return { ...definition, roles, nodes }
}
