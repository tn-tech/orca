// Planner runs (`workflow.draft`) are throwaway: once the draft is returned, abandoned (timeout,
// abort) or orphaned by a restart, the run is cancelled if still active, its worker stopped and its
// terminal released, and its run worktree removed. Planner runs are keyed on their version marker
// (isDraftPlannerRun), never their name, which a user's definition can also carry.
import { ACTIVE_ATTEMPT_STATES } from '../../../shared/workflows/workflow-node-states'
import type { RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { isDraftPlannerRun, DRAFT_PLANNER_WORKFLOW_NAME } from './workflow-draft-planner'
import type { WorkflowEngineWorktreeCleanup } from './workflow-engine'
import {
  createWorkflowOrchestrationClient,
  type WorkflowOrchestrationClient
} from './workflow-orchestration-client'
import { stopActiveAttempts, type WorkflowRunStopDeps } from './workflow-run-control'
import { WorkflowRunRecorder, type WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { wakeWorkflowRun } from './workflow-run-wake'

const TERMINAL_RUN_STATES = new Set<RunSnapshot['state']>(['completed', 'failed', 'cancelled'])
const TORN_DOWN_EVENT = 'draft_run_torn_down'

export type DraftRunTeardownReason = 'settled' | 'timeout' | 'aborted' | 'boot_sweep'

export type DraftRunTeardownDeps = WorkflowRunStopDeps & {
  runtime: WorkflowRunChangeNotifier & WorkflowEngineWorktreeCleanup
}

function isTornDown(db: OrchestrationDb, runId: string): boolean {
  return db.listWorkflowEventsOfKind(runId, TORN_DOWN_EVENT).length > 0
}

/** Synchronous so it can land before a rehydrate or the next controller tick reads the run. */
function cancelIfActive(
  db: OrchestrationDb,
  recorder: WorkflowRunRecorder,
  reason: DraftRunTeardownReason
): void {
  const run = db.getWorkflowRun(recorder.runId)
  if (run && !TERMINAL_RUN_STATES.has(run.state)) {
    recorder.transitionRun('cancelled', 'draft_run_abandoned', { reason })
    wakeWorkflowRun(recorder.runId)
  }
}

/** `false` when the release was refused or failed: the terminal may still be open. */
async function releaseWorker(
  client: WorkflowOrchestrationClient,
  recorder: WorkflowRunRecorder,
  dispatchId: string
): Promise<boolean> {
  try {
    await client.call('orchestration.workerRelease', { dispatch: dispatchId })
    return true
  } catch (error) {
    recorder.event('draft_worker_release_failed', {
      dispatchId,
      message: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

const STOP_CAUSE = { eventPrefix: 'draft_worker_stop', reason: 'draft_run_abandoned', subject: {} }

/**
 * Stops each still-active planner worker with the run-cancel rule (`stopActiveAttempts`): the
 * attempt is cancelled only on a proven `stopped`. Then releases (closes) each stopped worker's
 * terminal. `false` while any worker may still be alive, so the run stays eligible for the boot sweep.
 */
async function stopAndReleaseWorkers(
  deps: DraftRunTeardownDeps,
  recorder: WorkflowRunRecorder
): Promise<boolean> {
  let clean = await stopActiveAttempts(deps, recorder, STOP_CAUSE)
  const client = createWorkflowOrchestrationClient({
    dispatcher: deps.dispatcher,
    principal: { kind: 'workflow-engine', workflowRunId: recorder.runId }
  })
  for (const attempt of deps.db.listWorkflowAttempts(recorder.runId)) {
    if (
      attempt.dispatchId &&
      !ACTIVE_ATTEMPT_STATES.has(attempt.state) &&
      !(await releaseWorker(client, recorder, attempt.dispatchId))
    ) {
      clean = false
    }
  }
  return clean
}

/**
 * Idempotent. Anything left undone (an unconfirmed stop, a refused release, a failed worktree
 * removal) is recorded and leaves the run un-torn-down, so the next boot sweep retries it.
 */
export async function tearDownDraftRun(
  deps: DraftRunTeardownDeps,
  runId: string,
  reason: DraftRunTeardownReason
): Promise<void> {
  const run = deps.db.getWorkflowRun(runId)
  if (!run || !isDraftPlannerRun(run) || isTornDown(deps.db, runId)) {
    return
  }
  const recorder = new WorkflowRunRecorder(deps.db, deps.runtime, runId)
  cancelIfActive(deps.db, recorder, reason)
  // A worker-start still in flight records its dispatch only when the controller's tick returns.
  await deps.whenControllerSettled?.(runId)
  if (!(await stopAndReleaseWorkers(deps, recorder))) {
    return
  }
  // In-place planner runs used the repo's own checkout: there is nothing of theirs to remove.
  if (run.workflowSnapshot.workspacePolicy === 'run-workspace' && run.worktreeId) {
    try {
      await deps.runtime.removeManagedWorktree(`id:${run.worktreeId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recorder.event('draft_workspace_remove_failed', { worktreeId: run.worktreeId, message })
      console.warn(`[workflow-draft] could not remove planner workspace ${run.worktreeId}:`, error)
      return
    }
  }
  recorder.event(TORN_DOWN_EVENT, { reason })
}

function listDraftRunIds(db: OrchestrationDb): string[] {
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const page = db.listWorkflowRuns({
      name: DRAFT_PLANNER_WORKFLOW_NAME,
      ...(cursor ? { cursor } : {})
    })
    ids.push(...page.runs.filter(isDraftPlannerRun).map((run) => run.id))
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return ids
}

/**
 * Boot sweep: no request survives a restart to receive a planner's draft. The synchronous part
 * cancels every still-active planner run before the engine rehydrates, so none is relaunched;
 * the returned promise then stops, releases and removes what each left behind.
 */
export function sweepDraftRunsAtBoot(deps: DraftRunTeardownDeps): Promise<void> {
  const pending = listDraftRunIds(deps.db).filter((runId) => !isTornDown(deps.db, runId))
  for (const runId of pending) {
    cancelIfActive(deps.db, new WorkflowRunRecorder(deps.db, deps.runtime, runId), 'boot_sweep')
  }
  return (async () => {
    for (const runId of pending) {
      await tearDownDraftRun(deps, runId, 'boot_sweep')
    }
  })()
}
