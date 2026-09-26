import { useCallback, useEffect, useState } from 'react'
import {
  workflowRunShow,
  type RuntimeWorkflowSettings,
  type WorkflowRunSnapshotView
} from '@/runtime/runtime-workflow-client'
import {
  WORKFLOWS_CHANGED_EVENT,
  workflowsChangedWindowDetail
} from '@/lib/workflows-changed-window-event'
import type { NodeAttemptView } from '../../../../../shared/workflows/workflow-run-types'
import type { WorkflowAttemptState } from '../../../../../shared/workflows/workflow-node-states'

export type WorkflowRunSnapshotState = {
  snapshot: WorkflowRunSnapshotView | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export type UseWorkflowRunSnapshotParams = {
  settings: RuntimeWorkflowSettings
  /** No active run for the open workflow yet; the hook stays idle. */
  runId: string | null
}

/**
 * Owns the run-view's fetch lifecycle for `workflow.run.show` (FR-035). Refreshes on the
 * `workflows:changed` window event — the renderer-internal fan-out for both the desktop-local
 * `workflows:changed` IPC message and the paired-client `workflowRunChanged` event (U11) — rather
 * than polling.
 */
export function useWorkflowRunSnapshot({
  settings,
  runId
}: UseWorkflowRunSnapshotParams): WorkflowRunSnapshotState {
  const [snapshot, setSnapshot] = useState<WorkflowRunSnapshotView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!runId) {
      setSnapshot(null)
      setError(null)
      return
    }
    setLoading(true)
    try {
      const result = await workflowRunShow(settings, runId)
      setSnapshot(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [settings, runId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!runId) {
      return
    }
    // Missing/malformed detail degrades to an unscoped event (see workflowsChangedWindowDetail),
    // so an undefined detail.runId still refreshes rather than being dropped.
    const onChanged = (event: Event): void => {
      const detail = workflowsChangedWindowDetail(event)
      if (detail.runId && detail.runId !== runId) {
        return
      }
      void refresh()
    }
    window.addEventListener(WORKFLOWS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(WORKFLOWS_CHANGED_EVENT, onChanged)
  }, [refresh, runId])

  return { snapshot, loading, error, refresh }
}

function compareAttempts(a: NodeAttemptView, b: NodeAttemptView): number {
  if (a.iteration !== b.iteration) {
    return b.iteration - a.iteration
  }
  if (a.attemptIndex !== b.attemptIndex) {
    return b.attemptIndex - a.attemptIndex
  }
  return (b.startedAt ?? '').localeCompare(a.startedAt ?? '')
}

/** The attempt currently representing `nodeId`: highest iteration, then attempt index, then most
 *  recently started. Loop iteration display (T079) and retries both sort correctly through this. */
export function latestNodeAttempt(
  attempts: readonly NodeAttemptView[],
  nodeId: string
): NodeAttemptView | undefined {
  const forNode = attempts.filter((attempt) => attempt.nodeId === nodeId)
  return forNode.length > 0 ? [...forNode].sort(compareAttempts)[0] : undefined
}

/** One `WorkflowAttemptState` per node with at least one attempt — `RunCanvasOverlay`'s input for
 *  painting live states onto nodes (FR-035). */
export function nodeAttemptStatuses(
  snapshot: WorkflowRunSnapshotView | null
): Record<string, WorkflowAttemptState> {
  if (!snapshot) {
    return {}
  }
  const nodeIds = new Set(snapshot.attempts.map((attempt) => attempt.nodeId))
  const statuses: Record<string, WorkflowAttemptState> = {}
  for (const nodeId of nodeIds) {
    const attempt = latestNodeAttempt(snapshot.attempts, nodeId)
    if (attempt) {
      statuses[nodeId] = attempt.state
    }
  }
  return statuses
}
