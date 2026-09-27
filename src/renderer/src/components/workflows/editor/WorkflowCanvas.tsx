import React, { useCallback, useMemo } from 'react'
import '@xyflow/react/dist/style.css'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type NodeTypes,
  type OnConnect,
  type OnNodesChange
} from '@xyflow/react'
import type {
  AgentNode as AgentNodeDefinition,
  ReflectionNode as ReflectionNodeDefinition,
  RouterNode as RouterNodeDefinition,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../shared/workflows/workflow-node-states'
import { computeLoopContainerBounds } from './workflow-auto-layout'
import AgentNode, { type WorkflowAgentFlowNode } from './nodes/AgentNode'
import ApprovalNode, { type WorkflowApprovalFlowNode } from './nodes/ApprovalNode'
import EndNode, { type WorkflowEndFlowNode } from './nodes/EndNode'
import JoinNode, { type WorkflowJoinFlowNode } from './nodes/JoinNode'
import LoopNode, { type WorkflowLoopFlowNode } from './nodes/LoopNode'
import ReflectionNode, { type WorkflowReflectionFlowNode } from './nodes/ReflectionNode'
import RouterNode, { type WorkflowRouterFlowNode } from './nodes/RouterNode'
import StartNode, { type WorkflowStartFlowNode } from './nodes/StartNode'

type WorkflowFlowNode =
  | WorkflowAgentFlowNode
  | WorkflowStartFlowNode
  | WorkflowEndFlowNode
  | WorkflowLoopFlowNode
  | WorkflowJoinFlowNode
  | WorkflowRouterFlowNode
  | WorkflowApprovalFlowNode
  | WorkflowReflectionFlowNode

const NODE_TYPES: NodeTypes = {
  agent: AgentNode,
  start: StartNode,
  end: EndNode,
  loop: LoopNode,
  join: JoinNode,
  router: RouterNode,
  approval: ApprovalNode,
  reflection: ReflectionNode
}

export type WorkflowCanvasNodeStatuses = Readonly<Record<string, WorkflowAttemptState>>

/** The Loop node currently active for each node id (run view only, T079); keyed by the Loop's own
 *  id — `latestNodeAttempt`'s `iteration` for that Loop's `NodeAttemptView`. */
export type WorkflowCanvasNodeIterations = Readonly<Record<string, number>>

/** The worktree a dispatching node's attempt ran in (run view only, FR-035's "workspace used per
 *  node"), keyed by node id; only nodes that dispatch a worker (Agent, Router) ever have one. */
export type WorkflowCanvasNodeWorkspaces = Readonly<Record<string, string>>

export type WorkflowCanvasConnection = { from: string; to: string; fromPort?: string }

export type WorkflowCanvasProps = {
  definition: Workflow
  /** Per-node run status (run view overlay, later unit); absent in plain editing. */
  nodeStatuses?: WorkflowCanvasNodeStatuses
  /** Per-Loop-node active iteration (run view overlay, T079); absent in plain editing. */
  nodeIterations?: WorkflowCanvasNodeIterations
  /** Per-node workspace label (run view overlay, T087/T089); absent in plain editing. */
  nodeWorkspaces?: WorkflowCanvasNodeWorkspaces
  selectedNodeId?: string
  selectedEdgeId?: string
  onNodeSelect?: (nodeId: string | undefined) => void
  onEdgeSelect?: (edgeId: string | undefined) => void
  /** Fired once, on drag release — the editor state marks the node "manually positioned" (FR-010). */
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }) => void
  onConnect?: (connection: WorkflowCanvasConnection) => void
}

function resolveAgentLabel(
  definition: Workflow,
  node: AgentNodeDefinition | RouterNodeDefinition | ReflectionNodeDefinition
): string | undefined {
  const role = node.roleId ? definition.roles[node.roleId] : undefined
  return node.overrides?.agent ?? role?.agent
}

/** Body-node id -> owning Loop id, so those nodes render as React Flow children (T078). */
export function loopParentMap(nodes: Workflow['nodes']): Map<string, string> {
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
 * React Flow reports a child node's position relative to its parent (`parentId`), but
 * `definition.layout` is absolute canvas coordinates for every node alike (review round 1,
 * finding 3: storing the relative value as-is corrupted the layout, double-offsetting the node
 * on the next render and collapsing the Loop's computed container bounds). Converts a drag's
 * reported position back to absolute before it reaches `onNodeDragStop`; a no-op for any node
 * without a Loop parent.
 */
export function toAbsoluteNodePosition(
  layout: Workflow['layout'],
  parentOf: ReadonlyMap<string, string>,
  nodeId: string,
  reportedPosition: { x: number; y: number }
): { x: number; y: number } {
  const parentId = parentOf.get(nodeId)
  if (!parentId) {
    return reportedPosition
  }
  const parentPosition = layout[parentId] ?? { x: 0, y: 0 }
  return { x: reportedPosition.x + parentPosition.x, y: reportedPosition.y + parentPosition.y }
}

/**
 * Renders every non-body node first, then Loop body nodes as React Flow children (`parentId`,
 * position relative to the Loop, `extent: 'parent'`) — parents must precede their children in
 * the node array regardless of `definition.nodes`' own order.
 */
function toFlowNodes(
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

function toFlowEdges(definition: Workflow, selectedEdgeId: string | undefined): FlowEdge[] {
  return definition.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    sourceHandle: edge.fromPort,
    label: edge.fromPort,
    selected: edge.id === selectedEdgeId,
    style: { stroke: 'var(--border)' },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--border)' }
  }))
}

/** The DAG editor canvas (FR-002): renders `definition` with `@xyflow/react`, fully controlled. */
export default function WorkflowCanvas({
  definition,
  nodeStatuses,
  nodeIterations,
  nodeWorkspaces,
  selectedNodeId,
  selectedEdgeId,
  onNodeSelect,
  onEdgeSelect,
  onNodeDragStop,
  onConnect
}: WorkflowCanvasProps): React.JSX.Element {
  const parentOf = useMemo(() => loopParentMap(definition.nodes), [definition.nodes])
  const nodes = useMemo(
    () =>
      toFlowNodes(
        definition,
        nodeStatuses,
        nodeIterations,
        nodeWorkspaces,
        selectedNodeId,
        parentOf
      ),
    [definition, nodeStatuses, nodeIterations, nodeWorkspaces, selectedNodeId, parentOf]
  )
  const edges = useMemo(() => toFlowEdges(definition, selectedEdgeId), [definition, selectedEdgeId])

  const handleNodesChange: OnNodesChange<WorkflowFlowNode> = useCallback(
    (changes) => {
      if (!onNodeDragStop) {
        return
      }
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          onNodeDragStop(
            change.id,
            toAbsoluteNodePosition(definition.layout, parentOf, change.id, change.position)
          )
        }
      }
    },
    [definition.layout, onNodeDragStop, parentOf]
  )

  const handleConnect: OnConnect = useCallback(
    (connection: Connection) => {
      onConnect?.({
        from: connection.source,
        to: connection.target,
        fromPort: connection.sourceHandle ?? undefined
      })
    },
    [onConnect]
  )

  const handleNodeClick: NodeMouseHandler<WorkflowFlowNode> = useCallback(
    (_event, node) => onNodeSelect?.(node.id),
    [onNodeSelect]
  )

  const handleEdgeClick: EdgeMouseHandler<FlowEdge> = useCallback(
    (_event, edge) => onEdgeSelect?.(edge.id),
    [onEdgeSelect]
  )

  const handlePaneClick = useCallback(() => {
    onNodeSelect?.(undefined)
    onEdgeSelect?.(undefined)
  }, [onNodeSelect, onEdgeSelect])

  return (
    <div className="relative h-full w-full bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        fitView
        minZoom={0.2}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--border)" />
        <Controls
          showInteractive={false}
          className="!border-border !bg-card !text-card-foreground [&_button]:!border-border [&_button]:!bg-card [&_button]:!fill-current [&_button:hover]:!bg-accent"
        />
      </ReactFlow>
    </div>
  )
}
