import { useEffect, useRef, type RefObject } from 'react'
import { useReactFlow } from '@xyflow/react'
import { WORKFLOW_NODE_HEIGHT, WORKFLOW_NODE_WIDTH } from './workflow-auto-layout'
import { isNodeCenterOutOfView, newlyAddedNodeIds } from './workflow-canvas-viewport-fit'

export type WorkflowCanvasAutoFitProps = {
  /** Every node id currently rendered on the canvas. */
  nodeIds: readonly string[]
  containerRef: RefObject<HTMLDivElement | null>
}

/**
 * F10: `freeNodePosition` (`workflow-new-node-defaults.ts`) places a new node below the existing
 * layout, which can land well outside the current viewport — and `<ReactFlow>`'s `fitView` prop
 * only runs once, on mount. Diffs the rendered node id set every render; a genuinely new id that
 * isn't already on screen gets panned/zoomed into view. Rendered as a child of `<ReactFlow>` so
 * `useReactFlow` has the context it needs, same as `<Controls>`/`<Background>`.
 */
export default function WorkflowCanvasAutoFit({
  nodeIds,
  containerRef
}: WorkflowCanvasAutoFitProps): null {
  const reactFlow = useReactFlow()
  // Lazy seed (never `new Set(...)` inside `useRef`'s own argument, which re-evaluates every
  // render for no reason): the first render's node ids are the baseline nothing counts as "added".
  const previousIdsRef = useRef<ReadonlySet<string>>(undefined!)
  previousIdsRef.current ??= new Set(nodeIds)

  useEffect(() => {
    const addedIds = newlyAddedNodeIds(previousIdsRef.current, nodeIds)
    previousIdsRef.current = new Set(nodeIds)
    const container = containerRef.current
    if (addedIds.length === 0 || !container) {
      return
    }
    const addedNodes = addedIds
      .map((id) => reactFlow.getNode(id))
      .filter((node) => node !== undefined)
    if (addedNodes.length === 0) {
      return
    }

    const rect = container.getBoundingClientRect()
    const topLeft = reactFlow.screenToFlowPosition({ x: rect.left, y: rect.top })
    const bottomRight = reactFlow.screenToFlowPosition({ x: rect.right, y: rect.bottom })
    const visibleRect = {
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: bottomRight.x,
      maxY: bottomRight.y
    }
    const outOfView = addedNodes.some((node) =>
      isNodeCenterOutOfView(
        {
          x: node.position.x,
          y: node.position.y,
          width: node.measured?.width ?? node.width ?? WORKFLOW_NODE_WIDTH,
          height: node.measured?.height ?? node.height ?? WORKFLOW_NODE_HEIGHT
        },
        visibleRect
      )
    )
    if (outOfView) {
      void reactFlow.fitView({ padding: 0.2, duration: 300 })
    }
  }, [nodeIds, reactFlow, containerRef])

  return null
}
