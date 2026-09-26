import React, { useMemo } from 'react'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'
import WorkflowCanvas, { type WorkflowCanvasProps } from '../editor/WorkflowCanvas'
import { nodeAttemptIterations, nodeAttemptStatuses } from './use-workflow-run-snapshot'

export type RunCanvasOverlayProps = Omit<WorkflowCanvasProps, 'nodeStatuses' | 'nodeIterations'> & {
  /** `null` while the workflow hasn't been run yet (or is being edited between runs). */
  snapshot: WorkflowRunSnapshotView | null
}

/**
 * Paints live attempt states onto the canvas (FR-035): WorkflowCanvas already renders a status
 * dot per node from a `nodeStatuses` map (T065) and a Loop's iteration badge from `nodeIterations`
 * (T079), so this just derives both maps from the run snapshot and refreshes whenever
 * `use-workflow-run-snapshot.ts` delivers a new one.
 */
export default function RunCanvasOverlay({
  snapshot,
  ...canvasProps
}: RunCanvasOverlayProps): React.JSX.Element {
  const nodeStatuses = useMemo(() => nodeAttemptStatuses(snapshot), [snapshot])
  const nodeIterations = useMemo(() => nodeAttemptIterations(snapshot), [snapshot])
  return (
    <WorkflowCanvas {...canvasProps} nodeStatuses={nodeStatuses} nodeIterations={nodeIterations} />
  )
}
