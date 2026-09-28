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
  type OnEdgesChange,
  type OnNodesChange,
  type OnSelectionChangeFunc
} from '@xyflow/react'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { resolveSelectChange, resolveSelectionChange } from './workflow-canvas-selection-change'
import {
  toFlowNodes,
  type WorkflowCanvasNodeIterations,
  type WorkflowCanvasNodeStatuses,
  type WorkflowCanvasNodeWorkspaces,
  type WorkflowFlowNode
} from './workflow-canvas-flow-nodes'
import AgentNode from './nodes/AgentNode'
import ApprovalNode from './nodes/ApprovalNode'
import EndNode from './nodes/EndNode'
import JoinNode from './nodes/JoinNode'
import LoopNode from './nodes/LoopNode'
import ReflectionNode from './nodes/ReflectionNode'
import RouterNode from './nodes/RouterNode'
import StartNode from './nodes/StartNode'

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

export type {
  WorkflowCanvasNodeIterations,
  WorkflowCanvasNodeStatuses,
  WorkflowCanvasNodeWorkspaces
} from './workflow-canvas-flow-nodes'

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

/** F4: an edge must look selected once clicked, not just report `selected` to React Flow — the
 *  default theme's `.selected` class loses to this inline `style`, so the color has to change here. */
export function toFlowEdges(definition: Workflow, selectedEdgeId: string | undefined): FlowEdge[] {
  return definition.edges.map((edge) => {
    const selected = edge.id === selectedEdgeId
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      sourceHandle: edge.fromPort,
      label: edge.fromPort,
      selected,
      style: {
        stroke: selected ? 'var(--ring)' : 'var(--border)',
        strokeWidth: selected ? 2.5 : 1
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: selected ? 'var(--ring)' : 'var(--border)'
      }
    }
  })
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
      for (const change of changes) {
        if (
          onNodeDragStop &&
          change.type === 'position' &&
          change.dragging === false &&
          change.position
        ) {
          onNodeDragStop(
            change.id,
            toAbsoluteNodePosition(definition.layout, parentOf, change.id, change.position)
          )
        }
      }
      // F4 re-review 1, Minor #6: keyboard selection (Tab + Enter) arrives here as a `select`
      // change — see `resolveSelectChange`'s comment for why `onSelectionChange` alone can't
      // catch it.
      const selectChange = resolveSelectChange(changes)
      if (selectChange.changed) {
        onNodeSelect?.(selectChange.id)
      }
    },
    [definition.layout, onNodeDragStop, onNodeSelect, parentOf]
  )

  const handleEdgesChange: OnEdgesChange<FlowEdge> = useCallback(
    (changes) => {
      const selectChange = resolveSelectChange(changes)
      if (selectChange.changed) {
        onEdgeSelect?.(selectChange.id)
      }
    },
    [onEdgeSelect]
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

  const handleSelectionChange: OnSelectionChangeFunc<WorkflowFlowNode, FlowEdge> = useCallback(
    (params) => {
      const { nodeId, edgeId } = resolveSelectionChange(params)
      onNodeSelect?.(nodeId)
      onEdgeSelect?.(edgeId)
    },
    [onNodeSelect, onEdgeSelect]
  )

  return (
    <div className="relative h-full w-full bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onSelectionChange={handleSelectionChange}
        // F4: Delete/Backspace are handled by the editor's own shortcut
        // (workflow-editor-keyboard-shortcuts.ts), which also skips text inputs and open
        // dialogs/menus — React Flow's built-in handling knows none of that.
        deleteKeyCode={null}
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
