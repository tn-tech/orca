import { useCallback, useEffect, useRef, useState } from 'react'
import {
  workflowRunShow,
  type RuntimeWorkflowSettings,
  type WorkflowRunSnapshotView
} from '@/runtime/runtime-workflow-client'
import {
  WORKFLOWS_CHANGED_EVENT,
  workflowsChangedWindowDetail
} from '@/lib/workflows-changed-window-event'
import type { JsonValue, LoopNode } from '../../../../../shared/workflows/workflow-definition-types'
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
  // Tracks the runId as of the latest render so an in-flight fetch can tell, once it resolves,
  // whether it's still the one the caller cares about (see the stale-response guard in `refresh`).
  const runIdRef = useRef(runId)
  runIdRef.current = runId

  const refresh = useCallback(async () => {
    const requestedRunId = runId
    if (!requestedRunId) {
      setSnapshot(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await workflowRunShow(settings, requestedRunId)
      // Drop a stale response: the user may have switched workflows or started another run while
      // this fetch was in flight, and an older run's snapshot must never repopulate `snapshot`.
      if (runIdRef.current !== requestedRunId) {
        return
      }
      setSnapshot(result)
      setError(null)
    } catch (err) {
      if (runIdRef.current !== requestedRunId) {
        return
      }
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (runIdRef.current === requestedRunId) {
        setLoading(false)
      }
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

/** One attempt per iteration for `nodeId` — the latest `attemptIndex` within each iteration —
 *  ascending by iteration (FR-035/US2 AS1: per-iteration results in `AttemptPanel`). */
export function attemptsByIteration(
  attempts: readonly NodeAttemptView[],
  nodeId: string
): NodeAttemptView[] {
  const byIteration = new Map<number, NodeAttemptView>()
  for (const attempt of attempts) {
    if (attempt.nodeId !== nodeId) {
      continue
    }
    const current = byIteration.get(attempt.iteration)
    if (!current || attempt.attemptIndex >= current.attemptIndex) {
      byIteration.set(attempt.iteration, attempt)
    }
  }
  return [...byIteration.values()].sort((a, b) => a.iteration - b.iteration)
}

const TERMINAL_ATTEMPT_STATES: ReadonlySet<WorkflowAttemptState> = new Set([
  'completed',
  'failed',
  'skipped',
  'cancelled'
])

/** The engine's settled Loop result shape is `{ iterations, exitResult }` (U29); reads `iterations`
 *  back out without a cast, tolerating anything else `resultJson` could be. */
function settledIterationCount(resultJson: JsonValue | undefined): number | undefined {
  if (typeof resultJson !== 'object' || resultJson === null || Array.isArray(resultJson)) {
    return undefined
  }
  const iterations = resultJson.iterations
  return typeof iterations === 'number' ? iterations : undefined
}

/**
 * A Loop's currently active iteration, ready to display (review round 2): the engine keeps a
 * single Loop attempt at iteration 0, whose `resultJson` only becomes `{ iterations, exitResult }`
 * once it settles — so the Loop's own attempt can't be read directly while running. While
 * running, this is the highest `iteration` among the Loop's own body-node attempts (from
 * `loop.body.nodeIds`), converted from a 0-based index to a 1-based "how many iterations so far"
 * count (index 2 → 3). Once the Loop's attempt is settled, `resultJson.iterations` — the
 * engine's own authoritative final count — takes over. `undefined` before the Loop has any
 * activity at all (no badge to show yet).
 */
export function loopActiveIteration(
  loop: Pick<LoopNode, 'id' | 'body'>,
  attempts: readonly NodeAttemptView[]
): number | undefined {
  const loopAttempt = latestNodeAttempt(attempts, loop.id)
  if (loopAttempt && TERMINAL_ATTEMPT_STATES.has(loopAttempt.state)) {
    const settledCount = settledIterationCount(loopAttempt.resultJson)
    if (settledCount !== undefined) {
      return settledCount
    }
  }
  const bodyIds = new Set(loop.body.nodeIds)
  const bodyIterations = attempts
    .filter((attempt) => bodyIds.has(attempt.nodeId))
    .map((attempt) => attempt.iteration)
  return bodyIterations.length > 0 ? Math.max(...bodyIterations) + 1 : undefined
}

/** Every Loop node's currently active iteration (`loopActiveIteration`) — for the canvas badge
 *  (T079, `WorkflowCanvas`'s `nodeIterations` prop). */
export function nodeAttemptIterations(
  snapshot: WorkflowRunSnapshotView | null
): Record<string, number> {
  if (!snapshot) {
    return {}
  }
  const iterations: Record<string, number> = {}
  for (const node of snapshot.workflowSnapshot.nodes) {
    if (node.type !== 'loop') {
      continue
    }
    const active = loopActiveIteration(node, snapshot.attempts)
    if (active !== undefined) {
      iterations[node.id] = active
    }
  }
  return iterations
}

/** One `workspaceWorktreeId` per node with a latest attempt that recorded one (FR-035, "the run
 *  view shows which workspace each node used") — raw worktree ids; `RunCanvasOverlay` resolves
 *  them to display names, since that needs the worktree store this pure hook file doesn't touch. */
export function nodeAttemptWorkspaces(
  snapshot: WorkflowRunSnapshotView | null
): Record<string, string> {
  if (!snapshot) {
    return {}
  }
  const nodeIds = new Set(snapshot.attempts.map((attempt) => attempt.nodeId))
  const workspaces: Record<string, string> = {}
  for (const nodeId of nodeIds) {
    const worktreeId = latestNodeAttempt(snapshot.attempts, nodeId)?.workspaceWorktreeId
    if (worktreeId) {
      workspaces[nodeId] = worktreeId
    }
  }
  return workspaces
}
