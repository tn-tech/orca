import { useEffect } from 'react'
import { useNodes } from '@xyflow/react'
import { setMeasuredNodeSize } from './workflow-node-measurements'

/**
 * F10 round 1: records every rendered node's real DOM size, once React Flow's `ResizeObserver`
 * has measured it, into the `workflow-node-measurements.ts` registry — so the next "Re-layout"
 * can prefer it over `measureWorkflowNodeSize`'s estimate (controller ruling). `useNodes()`
 * subscribes to React Flow's own store, so this re-runs whenever a measurement lands, not just
 * when this canvas's own `nodes` prop changes. Rendered as a child of `<ReactFlow>` so `useNodes`
 * has the context it needs, same as `<Controls>`/`<Background>`/`WorkflowCanvasAutoFit`.
 */
export default function WorkflowCanvasMeasurementSync(): null {
  const nodes = useNodes()

  useEffect(() => {
    for (const node of nodes) {
      const { width, height } = node.measured ?? {}
      if (width !== undefined && height !== undefined) {
        setMeasuredNodeSize(node.id, { width, height })
      }
    }
  }, [nodes])

  return null
}
