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
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../shared/workflows/workflow-node-states'
import AgentNode, { type WorkflowAgentFlowNode } from './nodes/AgentNode'
import EndNode, { type WorkflowEndFlowNode } from './nodes/EndNode'
import StartNode, { type WorkflowStartFlowNode } from './nodes/StartNode'

type WorkflowFlowNode = WorkflowAgentFlowNode | WorkflowStartFlowNode | WorkflowEndFlowNode

const NODE_TYPES: NodeTypes = { agent: AgentNode, start: StartNode, end: EndNode }

export type WorkflowCanvasNodeStatuses = Readonly<Record<string, WorkflowAttemptState>>

export type WorkflowCanvasConnection = { from: string; to: string; fromPort?: string }

export type WorkflowCanvasProps = {
  definition: Workflow
  /** Per-node run status (run view overlay, later unit); absent in plain editing. */
  nodeStatuses?: WorkflowCanvasNodeStatuses
  selectedNodeId?: string
  selectedEdgeId?: string
  onNodeSelect?: (nodeId: string | undefined) => void
  onEdgeSelect?: (edgeId: string | undefined) => void
  /** Fired once, on drag release — the editor state marks the node "manually positioned" (FR-010). */
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }) => void
  onConnect?: (connection: WorkflowCanvasConnection) => void
}

function resolveAgentLabel(definition: Workflow, node: AgentNodeDefinition): string | undefined {
  const role = node.roleId ? definition.roles[node.roleId] : undefined
  return node.overrides?.agent ?? role?.agent
}

function toFlowNodes(
  definition: Workflow,
  nodeStatuses: WorkflowCanvasNodeStatuses | undefined,
  selectedNodeId: string | undefined
): WorkflowFlowNode[] {
  const flowNodes: WorkflowFlowNode[] = []
  for (const node of definition.nodes) {
    const position = definition.layout[node.id] ?? { x: 0, y: 0 }
    const selected = node.id === selectedNodeId
    const attemptState = nodeStatuses?.[node.id]
    if (node.type === 'start') {
      flowNodes.push({
        id: node.id,
        type: 'start',
        position,
        selected,
        data: { definitionNode: node, attemptState }
      })
    } else if (node.type === 'end') {
      flowNodes.push({
        id: node.id,
        type: 'end',
        position,
        selected,
        data: { definitionNode: node, attemptState }
      })
    } else if (node.type === 'agent') {
      flowNodes.push({
        id: node.id,
        type: 'agent',
        position,
        selected,
        data: {
          definitionNode: node,
          agentLabel: resolveAgentLabel(definition, node),
          attemptState
        }
      })
    }
    // Router/Loop/Join/Approval/Reflection node components land in later units (T078, T087, T089, T111, T120).
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
  selectedNodeId,
  selectedEdgeId,
  onNodeSelect,
  onEdgeSelect,
  onNodeDragStop,
  onConnect
}: WorkflowCanvasProps): React.JSX.Element {
  const nodes = useMemo(
    () => toFlowNodes(definition, nodeStatuses, selectedNodeId),
    [definition, nodeStatuses, selectedNodeId]
  )
  const edges = useMemo(() => toFlowEdges(definition, selectedEdgeId), [definition, selectedEdgeId])

  const handleNodesChange: OnNodesChange<WorkflowFlowNode> = useCallback(
    (changes) => {
      if (!onNodeDragStop) {
        return
      }
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          onNodeDragStop(change.id, change.position)
        }
      }
    },
    [onNodeDragStop]
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
