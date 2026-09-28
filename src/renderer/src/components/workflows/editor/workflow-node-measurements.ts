import type { MeasuredNodeSize } from './workflow-auto-layout'

/**
 * The latest real DOM size React Flow has measured for each node id, written by
 * `WorkflowCanvasMeasurementSync.tsx` and read by the `auto-layout` reducer case
 * (`use-workflow-editor-state.ts`) so "Re-layout" can prefer a real size over
 * `measureWorkflowNodeSize`'s estimate (F10 round 1 review, Important #3 controller ruling). A
 * module-level registry, not a prop threaded through the toolbar that dispatches `auto-layout`,
 * because the measurement lives in React Flow's own internal store, several components away from
 * that dispatch call.
 */
const measuredSizes = new Map<string, MeasuredNodeSize>()

export function setMeasuredNodeSize(id: string, size: MeasuredNodeSize): void {
  measuredSizes.set(id, size)
}

/** A snapshot `computeAutoLayout`'s `measuredSizes` option can use; copied so the caller can't
 *  mutate the live registry through it. */
export function getMeasuredNodeSizes(): ReadonlyMap<string, MeasuredNodeSize> {
  return new Map(measuredSizes)
}

/** Drops every recorded size — a freshly loaded/opened definition (`load-definition`) shouldn't
 *  carry over sizes measured for a different workflow's nodes. */
export function clearMeasuredNodeSizes(): void {
  measuredSizes.clear()
}
