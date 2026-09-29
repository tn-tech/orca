import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react'
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
  type EdgeTypes,
  type NodeMouseHandler,
  type NodeTypes,
  type OnConnect,
  type OnEdgesChange,
  type OnInit,
  type OnNodesChange,
  type ReactFlowInstance
} from '@xyflow/react'
import type { Edge, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import type { MeasuredNodeSize } from './workflow-auto-layout'
import { resolveSelectChange } from './workflow-canvas-selection-change'
import { loopParentMap } from './workflow-auto-layout'
import { computeEdgeBendLanes } from './workflow-edge-routing'
import {
  toFlowNodes,
  type WorkflowCanvasNodeIterations,
  type WorkflowCanvasNodeStatuses,
  type WorkflowCanvasNodeWorkspaces,
  type WorkflowFlowNode
} from './workflow-canvas-flow-nodes'
import type { WorkflowCanvasNodeProblems } from './workflow-node-problem-summary'
import AgentNode from './nodes/AgentNode'
import ApprovalNode from './nodes/ApprovalNode'
import EndNode from './nodes/EndNode'
import JoinNode from './nodes/JoinNode'
import LoopNode from './nodes/LoopNode'
import ReflectionNode from './nodes/ReflectionNode'
import RouterNode from './nodes/RouterNode'
import StartNode from './nodes/StartNode'
import WorkflowCanvasAutoFit from './WorkflowCanvasAutoFit'
import WorkflowDagEdge from './WorkflowDagEdge'

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

const EDGE_TYPES: EdgeTypes = { dag: WorkflowDagEdge }

export { loopParentMap }

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
  /** F7: per-node validation problems, flagged inline on each card. */
  nodeProblems?: WorkflowCanvasNodeProblems
  selectedNodeId?: string
  selectedEdgeId?: string
  onNodeSelect?: (nodeId: string | undefined) => void
  onEdgeSelect?: (edgeId: string | undefined) => void
  /** Fired once, on drag release — the editor state marks the node "manually positioned" (FR-010). */
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }) => void
  onConnect?: (connection: WorkflowCanvasConnection) => void
}

/** Re-layout's own read of React Flow's real per-node sizes, pulled on demand rather than synced
 *  into any store — `getInternalNode` always reflects the current DOM measurement regardless of
 *  the controlled `nodes` prop (round 2: `useNodes()` returns the echoed prop, never `.measured`). */
export type WorkflowCanvasHandle = {
  getMeasuredSizes: () => ReadonlyMap<string, MeasuredNodeSize>
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

/** Mirrors the engine's `loopExitSourceId` (workflow-frontier.ts) for rendering: `from` on a Loop
 *  exit edge stays the inner body node (`reconnectEdgesForLoop`), but only `LoopNode` has an
 *  `exit` handle — without this, React Flow can't resolve the handle and drops the edge (F10
 *  round 1). */
export function resolveEdgeSourceId(
  parentOf: ReadonlyMap<string, string>,
  edge: Pick<Edge, 'from' | 'fromPort'>
): string {
  return edge.fromPort === 'exit' ? (parentOf.get(edge.from) ?? edge.from) : edge.from
}

/** F4: an edge must look selected once clicked, not just report `selected` to React Flow — the
 *  default theme's `.selected` class loses to this inline `style`, so the color has to change here.
 *  Every edge renders as the custom `dag` type (`WorkflowDagEdge.tsx`), bent through `bendLanes`'
 *  lane for it (`computeEdgeBendLanes`) or the default bezier when there's none (F10). */
export function toFlowEdges(
  definition: Workflow,
  selectedEdgeId: string | undefined,
  bendLanes: ReadonlyMap<string, number> = new Map(),
  parentOf: ReadonlyMap<string, string> = new Map()
): FlowEdge[] {
  return definition.edges.map((edge) => {
    const selected = edge.id === selectedEdgeId
    return {
      id: edge.id,
      type: 'dag',
      source: resolveEdgeSourceId(parentOf, edge),
      target: edge.to,
      sourceHandle: edge.fromPort,
      label: edge.fromPort,
      selected,
      data: { laneY: bendLanes.get(edge.id) },
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
const WorkflowCanvas = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
  function WorkflowCanvas(
    {
      definition,
      nodeStatuses,
      nodeIterations,
      nodeWorkspaces,
      nodeProblems,
      selectedNodeId,
      selectedEdgeId,
      onNodeSelect,
      onEdgeSelect,
      onNodeDragStop,
      onConnect
    },
    ref
  ) {
    const reactFlowInstanceRef = useRef<ReactFlowInstance<WorkflowFlowNode, FlowEdge> | null>(null)
    useImperativeHandle(
      ref,
      () => ({
        getMeasuredSizes: () => {
          const instance = reactFlowInstanceRef.current
          const sizes = new Map<string, MeasuredNodeSize>()
          if (!instance) {
            return sizes
          }
          for (const node of instance.getNodes()) {
            const measured = instance.getInternalNode(node.id)?.measured
            if (measured?.width !== undefined && measured.height !== undefined) {
              sizes.set(node.id, { width: measured.width, height: measured.height })
            }
          }
          return sizes
        }
      }),
      []
    )
    const handleInit: OnInit<WorkflowFlowNode, FlowEdge> = useCallback((instance) => {
      reactFlowInstanceRef.current = instance
    }, [])

    const parentOf = useMemo(() => loopParentMap(definition.nodes), [definition.nodes])
    const nodes = useMemo(
      () =>
        toFlowNodes(definition, {
          nodeStatuses,
          nodeIterations,
          nodeWorkspaces,
          nodeProblems,
          selectedNodeId,
          parentOf
        }),
      [
        definition,
        nodeStatuses,
        nodeIterations,
        nodeWorkspaces,
        nodeProblems,
        selectedNodeId,
        parentOf
      ]
    )
    const bendLanes = useMemo(
      () => computeEdgeBendLanes(definition.nodes, definition.edges, definition.layout),
      [definition.nodes, definition.edges, definition.layout]
    )
    const edges = useMemo(
      () => toFlowEdges(definition, selectedEdgeId, bendLanes, parentOf),
      [definition, selectedEdgeId, bendLanes, parentOf]
    )
    const nodeIds = useMemo(() => nodes.map((node) => node.id), [nodes])
    const containerRef = useRef<HTMLDivElement | null>(null)

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

    return (
      <div ref={containerRef} className="relative h-full w-full bg-background">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          // No `onSelectionChange`: React Flow re-sends its one-render-stale selection whenever
          // that callback changes identity, which ping-pongs a controlled canvas. Clicks and
          // keyboard selection are already covered by the handlers above.
          onPaneClick={handlePaneClick}
          onInit={handleInit}
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
          <WorkflowCanvasAutoFit nodeIds={nodeIds} containerRef={containerRef} />
        </ReactFlow>
      </div>
    )
  }
)

export default WorkflowCanvas
