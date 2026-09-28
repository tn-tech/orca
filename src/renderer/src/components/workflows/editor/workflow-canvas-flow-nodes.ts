import type {
  AgentNode as AgentNodeDefinition,
  ReflectionNode as ReflectionNodeDefinition,
  RouterNode as RouterNodeDefinition,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../shared/workflows/workflow-node-states'
import { computeLoopContainerBounds } from './workflow-auto-layout'
import type { WorkflowApprovalFlowNode } from './nodes/ApprovalNode'
import type { WorkflowAgentFlowNode } from './nodes/AgentNode'
import type { WorkflowEndFlowNode } from './nodes/EndNode'
import type { WorkflowJoinFlowNode } from './nodes/JoinNode'
import type { WorkflowLoopFlowNode } from './nodes/LoopNode'
import type { WorkflowReflectionFlowNode } from './nodes/ReflectionNode'
import type { WorkflowRouterFlowNode } from './nodes/RouterNode'
import type { WorkflowStartFlowNode } from './nodes/StartNode'

// Split out of WorkflowCanvas.tsx (F4 re-review 1) to keep that file under the 400-line `.tsx` cap.
export type WorkflowFlowNode =
  | WorkflowAgentFlowNode
  | WorkflowStartFlowNode
  | WorkflowEndFlowNode
  | WorkflowLoopFlowNode
  | WorkflowJoinFlowNode
  | WorkflowRouterFlowNode
  | WorkflowApprovalFlowNode
  | WorkflowReflectionFlowNode

export type WorkflowCanvasNodeStatuses = Readonly<Record<string, WorkflowAttemptState>>

/** The Loop node currently active for each node id (run view only, T079); keyed by the Loop's own
 *  id — `latestNodeAttempt`'s `iteration` for that Loop's `NodeAttemptView`. */
export type WorkflowCanvasNodeIterations = Readonly<Record<string, number>>

/** The worktree a dispatching node's attempt ran in (run view only, FR-035's "workspace used per
 *  node"), keyed by node id; only nodes that dispatch a worker (Agent, Router) ever have one. */
export type WorkflowCanvasNodeWorkspaces = Readonly<Record<string, string>>

function resolveAgentLabel(
  definition: Workflow,
  node: AgentNodeDefinition | RouterNodeDefinition | ReflectionNodeDefinition
): string | undefined {
  const role = node.roleId ? definition.roles[node.roleId] : undefined
  return node.overrides?.agent ?? role?.agent
}

/**
 * Renders every non-body node first, then Loop body nodes as React Flow children (`parentId`,
 * position relative to the Loop, `extent: 'parent'`) — parents must precede their children in
 * the node array regardless of `definition.nodes`' own order.
 */
export function toFlowNodes(
  definition: Workflow,
  nodeStatuses: WorkflowCanvasNodeStatuses | undefined,
  nodeIterations: WorkflowCanvasNodeIterations | undefined,
  nodeWorkspaces: WorkflowCanvasNodeWorkspaces | undefined,
  selectedNodeId: string | undefined,
  parentOf: ReadonlyMap<string, string>
): WorkflowFlowNode[] {
  const [ownNodes, bodyNodes] = [
    definition.nodes.filter((node) => !parentOf.has(node.id)),
    definition.nodes.filter((node) => parentOf.has(node.id))
  ]

  const flowNodes: WorkflowFlowNode[] = []
  for (const node of [...ownNodes, ...bodyNodes]) {
    const absolutePosition = definition.layout[node.id] ?? { x: 0, y: 0 }
    const parentId = parentOf.get(node.id)
    const parentPosition = parentId ? (definition.layout[parentId] ?? { x: 0, y: 0 }) : undefined
    const position = parentPosition
      ? { x: absolutePosition.x - parentPosition.x, y: absolutePosition.y - parentPosition.y }
      : absolutePosition
    const selected = node.id === selectedNodeId
    const attemptState = nodeStatuses?.[node.id]
    const nesting = parentId ? ({ parentId, extent: 'parent' } as const) : {}

    if (node.type === 'start') {
      flowNodes.push({
        id: node.id,
        type: 'start',
        position,
        selected,
        ...nesting,
        data: { definitionNode: node, attemptState }
      })
    } else if (node.type === 'end') {
      flowNodes.push({
        id: node.id,
        type: 'end',
        position,
        selected,
        ...nesting,
        data: { definitionNode: node, attemptState }
      })
    } else if (node.type === 'agent') {
      flowNodes.push({
        id: node.id,
        type: 'agent',
        position,
        selected,
        ...nesting,
        data: {
          definitionNode: node,
          agentLabel: resolveAgentLabel(definition, node),
          attemptState,
          workspaceLabel: nodeWorkspaces?.[node.id]
        }
      })
    } else if (node.type === 'join') {
      flowNodes.push({
        id: node.id,
        type: 'join',
        position,
        selected,
        ...nesting,
        data: { definitionNode: node, attemptState }
      })
    } else if (node.type === 'router') {
      flowNodes.push({
        id: node.id,
        type: 'router',
        position,
        selected,
        ...nesting,
        data: {
          definitionNode: node,
          agentLabel: resolveAgentLabel(definition, node),
          attemptState,
          workspaceLabel: nodeWorkspaces?.[node.id]
        }
      })
    } else if (node.type === 'loop') {
      const bounds = computeLoopContainerBounds(
        absolutePosition,
        node.body.nodeIds.map((id) => definition.layout[id] ?? { x: 0, y: 0 })
      )
      flowNodes.push({
        id: node.id,
        type: 'loop',
        position,
        selected,
        style: { width: bounds.width, height: bounds.height },
        data: {
          definitionNode: node,
          attemptState,
          iteration: nodeIterations?.[node.id],
          ...bounds
        }
      })
    } else if (node.type === 'approval') {
      flowNodes.push({
        id: node.id,
        type: 'approval',
        position,
        selected,
        ...nesting,
        data: { definitionNode: node, attemptState }
      })
    } else if (node.type === 'reflection') {
      flowNodes.push({
        id: node.id,
        type: 'reflection',
        position,
        selected,
        ...nesting,
        data: {
          definitionNode: node,
          agentLabel: resolveAgentLabel(definition, node),
          attemptState,
          workspaceLabel: nodeWorkspaces?.[node.id]
        }
      })
    }
  }
  return flowNodes
}
