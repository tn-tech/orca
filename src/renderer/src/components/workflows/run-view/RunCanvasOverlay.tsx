import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'
import { useWorktreeMap } from '@/store/selectors'
import WorkflowCanvas, {
  type WorkflowCanvasHandle,
  type WorkflowCanvasProps
} from '../editor/WorkflowCanvas'
import {
  nodeAttemptIterations,
  nodeAttemptStatuses,
  nodeAttemptWorkspaces
} from './use-workflow-run-snapshot'

export type RunCanvasOverlayProps = Omit<
  WorkflowCanvasProps,
  'nodeStatuses' | 'nodeIterations' | 'nodeWorkspaces'
> & {
  /** `null` while the workflow hasn't been run yet (or is being edited between runs). */
  snapshot: WorkflowRunSnapshotView | null
}

/** Raw worktree ids -> a name worth showing; falls back to the id itself when the worktree isn't
 *  (or isn't yet) known to this client, e.g. one on a host this client hasn't loaded. */
function resolveWorkspaceLabels(
  worktreeIds: Record<string, string>,
  worktreeMap: ReadonlyMap<string, { displayName: string }>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(worktreeIds).map(([nodeId, worktreeId]) => [
      nodeId,
      worktreeMap.get(worktreeId)?.displayName ?? worktreeId
    ])
  )
}

/**
 * Paints live attempt states onto the canvas (FR-035): WorkflowCanvas already renders a status
 * dot per node from a `nodeStatuses` map (T065), a Loop's iteration badge from `nodeIterations`
 * (T079), and a workspace label from `nodeWorkspaces` (T087/T089), so this just derives all three
 * from the run snapshot and refreshes whenever `use-workflow-run-snapshot.ts` delivers a new one.
 *
 * While a run is showing (`snapshot` set), a node's card carries an extra workspace-label row a
 * plain editing card doesn't, so its real size isn't the size Re-layout should reserve for
 * ordinary editing. `getMeasuredSizes` returns empty in that case instead of forwarding to the
 * canvas underneath.
 */
const RunCanvasOverlay = forwardRef<WorkflowCanvasHandle, RunCanvasOverlayProps>(
  function RunCanvasOverlay({ snapshot, ...canvasProps }, ref) {
    const canvasRef = useRef<WorkflowCanvasHandle>(null)
    useImperativeHandle(
      ref,
      () => ({
        getMeasuredSizes: () =>
          snapshot ? new Map() : (canvasRef.current?.getMeasuredSizes() ?? new Map())
      }),
      [snapshot]
    )
    const nodeStatuses = useMemo(() => nodeAttemptStatuses(snapshot), [snapshot])
    const nodeIterations = useMemo(() => nodeAttemptIterations(snapshot), [snapshot])
    const worktreeMap = useWorktreeMap()
    const nodeWorkspaces = useMemo(
      () => resolveWorkspaceLabels(nodeAttemptWorkspaces(snapshot), worktreeMap),
      [snapshot, worktreeMap]
    )
    return (
      <WorkflowCanvas
        ref={canvasRef}
        {...canvasProps}
        nodeStatuses={nodeStatuses}
        nodeIterations={nodeIterations}
        nodeWorkspaces={nodeWorkspaces}
      />
    )
  }
)

export default RunCanvasOverlay
