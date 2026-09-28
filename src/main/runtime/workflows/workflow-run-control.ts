// Pause, resume and cancel of a workflow run (FR-030). Pause only holds back new launches (the
// controller defers its advance); running workers finish and open questions stay answerable.
// Cancel marks the run cancelled first, so no controller launches anything more, then asks every
// live worker to stop; an attempt is cancelled only on a proven stop, never assumed exited.
import type { WorkflowRunState } from '../../../shared/workflows/workflow-node-states'
import { ACTIVE_ATTEMPT_STATES } from '../../../shared/workflows/workflow-node-states'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { failUndeliveredFollowUps } from './workflow-follow-up-delivery'
import { stopWorkerAttempt, type WorkerStopCause } from './workflow-join-branch-stop'
import {
  createWorkflowOrchestrationClient,
  type WorkflowOrchestrationDispatcher
} from './workflow-orchestration-client'
import { WorkflowRunRecorder, type WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { wakeWorkflowRun } from './workflow-run-wake'

export type WorkflowRunStopDeps = {
  db: OrchestrationDb
  runtime: WorkflowRunChangeNotifier
  /** The engine's own dispatcher: worker stops run under the run's engine principal. */
  dispatcher: WorkflowOrchestrationDispatcher
  /** `WorkflowEngine.whenControllerSettled`; absent where no controller can be live. */
  whenControllerSettled?: (runId: string) => Promise<void>
}

function requireRunState(db: OrchestrationDb, runId: string): WorkflowRunState {
  const state = db.getWorkflowRun(runId)?.state
  if (state === undefined) {
    throw new Error('workflow_not_found')
  }
  return state
}

function transition(
  db: OrchestrationDb,
  notifier: WorkflowRunChangeNotifier,
  runId: string,
  toState: WorkflowRunState,
  kind: string
): WorkflowRunState {
  const from = requireRunState(db, runId)
  new WorkflowRunRecorder(db, notifier, runId).transitionRun(toState, kind, { from })
  wakeWorkflowRun(runId)
  return toState
}

export function pauseWorkflowRun(
  db: OrchestrationDb,
  notifier: WorkflowRunChangeNotifier,
  runId: string
): WorkflowRunState {
  return requireRunState(db, runId) === 'paused'
    ? 'paused'
    : transition(db, notifier, runId, 'paused', 'run_paused')
}

/** Back to `waiting` while a question is still open, as a run that was never paused would be. */
export function resumeWorkflowRun(
  db: OrchestrationDb,
  notifier: WorkflowRunChangeNotifier,
  runId: string
): WorkflowRunState {
  const state = requireRunState(db, runId)
  if (state !== 'paused') {
    throw new OrchestrationError('workflow_run_transition_invalid', `Run ${runId} is not paused.`, {
      runId,
      from: state,
      to: 'running'
    })
  }
  const target = db.listOpenWorkflowQuestions(runId).length > 0 ? 'waiting' : 'running'
  return transition(db, notifier, runId, target, 'run_resumed')
}

const CANCEL_CAUSE: WorkerStopCause = {
  eventPrefix: 'run_cancel_stop',
  reason: 'run_cancelled',
  subject: {}
}

/**
 * Asks each live worker to stop and cancels what never reached a worker. `false` while any
 * worker may still be alive (its stop was refused or unconfirmed), leaving that attempt as is.
 */
export async function stopActiveAttempts(
  deps: WorkflowRunStopDeps,
  recorder: WorkflowRunRecorder,
  cause: WorkerStopCause
): Promise<boolean> {
  const client = createWorkflowOrchestrationClient({
    dispatcher: deps.dispatcher,
    principal: { kind: 'workflow-engine', workflowRunId: recorder.runId }
  })
  const active = deps.db
    .listWorkflowAttempts(recorder.runId)
    .filter((attempt) => ACTIVE_ATTEMPT_STATES.has(attempt.state))
  for (const attempt of active.filter((candidate) => !candidate.dispatchId)) {
    // The controller has settled, so no worker-start is still in flight for it.
    recorder.transitionAttempt(attempt.id, 'cancelled', { reason: cause.reason })
  }
  const workers = active.filter((candidate) => candidate.dispatchId)
  await Promise.all(
    workers.map((attempt) => stopWorkerAttempt({ recorder, client }, attempt, cause))
  )
  const after = new Map(deps.db.listWorkflowAttempts(recorder.runId).map((a) => [a.id, a.state]))
  return workers.every((attempt) => {
    const state = after.get(attempt.id)
    return state === undefined || !ACTIVE_ATTEMPT_STATES.has(state)
  })
}

/** Idempotent for an already-cancelled run; a completed or failed run refuses the transition. */
export async function cancelWorkflowRun(
  deps: WorkflowRunStopDeps,
  runId: string
): Promise<WorkflowRunState> {
  const state = requireRunState(deps.db, runId)
  if (state === 'cancelled') {
    return state
  }
  const recorder = new WorkflowRunRecorder(deps.db, deps.runtime, runId)
  // Synchronous, so it lands before the controller's next tick reads the run.
  recorder.transitionRun('cancelled', 'run_cancelled', { from: state })
  wakeWorkflowRun(runId)
  // A worker-start still in flight records its dispatch only when the controller's tick returns.
  await deps.whenControllerSettled?.(runId)
  await stopActiveAttempts(deps, recorder, CANCEL_CAUSE)
  // The controller settles these as it exits; with none live, nothing else would.
  failUndeliveredFollowUps(deps.db, recorder)
  return 'cancelled'
}
