// Maps each dispatched attempt's worker-list liveness verdict (live / unverifiable / exited) onto
// the attempt (FR-032, docs/reference/ssh-execution-boundary.md): anything short of `live` makes a
// running attempt `unverifiable` and `live` returns it to `running`. A confirmed `exited` is
// returned to the controller, which fails the attempt only once its mailbox backlog holds no
// report for it (failExitedAttempts). Silence is never read as an exit.
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'
import type { WorkflowRunRecorder } from './workflow-run-recorder'
import { ensureTaskStatus } from './workflow-worker-done'

/** How often a run with dispatched workers re-reads their verdicts while otherwise idle. */
export const ATTEMPT_LIVENESS_INTERVAL_MS = 60_000

export const WORKER_EXITED_WITHOUT_REPORT_REASON = 'Agent exited without reporting completion.'

const WATCHED_STATES = new Set<NodeAttemptView['state']>(['running', 'unverifiable'])

type LivenessReading =
  | { verdict: 'live' }
  | { verdict: 'exited' }
  | { verdict: 'unverifiable'; reason: string; detail?: string }

type WatchedAttempt = NodeAttemptView & { dispatchId: string }

/** An attempt whose worker the host confirmed exited, keyed to the Dispatch it was read for. */
export type ExitedAttempt = { attemptId: string; dispatchId: string }

function watchedAttempts(ctx: WorkflowNodeLaunchContext): WatchedAttempt[] {
  return ctx.db
    .listWorkflowAttempts(ctx.recorder.runId)
    .filter(
      (attempt): attempt is WatchedAttempt =>
        WATCHED_STATES.has(attempt.state) && attempt.dispatchId !== undefined
    )
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

/** worker-list's result is `unknown` in process; an unrecognised verdict reads as unverifiable. */
function readVerdicts(result: unknown): Map<string, LivenessReading> {
  const readings = new Map<string, LivenessReading>()
  const workers = field(result, 'workers')
  for (const worker of Array.isArray(workers) ? workers : []) {
    const dispatchId = field(worker, 'dispatchId')
    const liveness = field(field(worker, 'projection'), 'liveness')
    const verdict = field(liveness, 'verdict')
    if (typeof dispatchId !== 'string') {
      continue
    }
    if (verdict === 'live' || verdict === 'exited') {
      readings.set(dispatchId, { verdict })
      continue
    }
    const reason = field(liveness, 'reason')
    readings.set(dispatchId, {
      verdict: 'unverifiable',
      reason: typeof reason === 'string' ? reason : 'unrecognized_verdict'
    })
  }
  return readings
}

async function readRunLiveness(
  ctx: WorkflowNodeLaunchContext,
  engineRunId: string,
  watched: readonly WatchedAttempt[]
): Promise<Map<string, LivenessReading> | { unreadable: string }> {
  // Only federated Dispatches need a remote snapshot; SSH and local ones answer from this host.
  const includeRemote = watched.some((attempt) => ctx.db.getFederatedDispatch(attempt.dispatchId))
  try {
    return readVerdicts(
      await ctx.client.call('orchestration.workerList', { run: engineRunId, includeRemote })
    )
  } catch (error) {
    // Could not ask: that observes nothing about the workers, so every one is unverifiable.
    return { unreadable: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * One sweep over the run's dispatched attempts; never throws into the controller. Returns the
 * attempts the host confirmed `exited`, for the controller to settle after draining its mailbox.
 */
export async function reconcileAttemptLiveness(
  ctx: WorkflowNodeLaunchContext,
  engineRunId: string
): Promise<ExitedAttempt[]> {
  const watched = watchedAttempts(ctx)
  if (watched.length === 0) {
    return []
  }
  const readings = await readRunLiveness(ctx, engineRunId, watched)
  if (ctx.signal?.aborted) {
    return []
  }
  const exited: ExitedAttempt[] = []
  // Re-read: a worker_done or question may have settled an attempt while worker-list ran.
  for (const attempt of watchedAttempts(ctx)) {
    const reading: LivenessReading =
      readings instanceof Map
        ? (readings.get(attempt.dispatchId) ?? { verdict: 'unverifiable', reason: 'not_listed' })
        : { verdict: 'unverifiable', reason: 'liveness_unreadable', detail: readings.unreadable }
    if (reading.verdict === 'exited') {
      exited.push({ attemptId: attempt.id, dispatchId: attempt.dispatchId })
    } else if (reading.verdict === 'unverifiable' && attempt.state === 'running') {
      ctx.recorder.transitionAttempt(attempt.id, 'unverifiable', {
        dispatchId: attempt.dispatchId,
        reason: reading.reason,
        ...(reading.detail === undefined ? {} : { detail: reading.detail })
      })
    } else if (reading.verdict === 'live' && attempt.state === 'unverifiable') {
      ctx.recorder.transitionAttempt(attempt.id, 'running', {
        dispatchId: attempt.dispatchId,
        reason: 'liveness_confirmed'
      })
    }
  }
  return exited
}

/**
 * Fails each confirmed-exited attempt that is still unsettled on the same Dispatch. The caller
 * runs this only after the mailbox backlog was drained, so a report the worker sent before it
 * exited has already settled its attempt; `true` when any attempt failed.
 */
export async function failExitedAttempts(
  ctx: WorkflowNodeLaunchContext,
  exited: readonly ExitedAttempt[]
): Promise<boolean> {
  let failed = false
  const attempts = ctx.db.listWorkflowAttempts(ctx.recorder.runId)
  for (const { attemptId, dispatchId } of exited) {
    const attempt = attempts.find((candidate) => candidate.id === attemptId)
    if (!attempt || !WATCHED_STATES.has(attempt.state) || attempt.dispatchId !== dispatchId) {
      continue
    }
    ctx.db.updateWorkflowAttempt(attemptId, { failureReason: WORKER_EXITED_WITHOUT_REPORT_REASON })
    try {
      await ensureTaskStatus(ctx, attempt.taskId, 'failed')
    } catch (error) {
      // The host refuses while it still counts the Dispatch active; the attempt's verdict stands.
      ctx.recorder.event(
        'task_status_unsettled',
        {
          taskId: attempt.taskId ?? null,
          message: error instanceof Error ? error.message : String(error)
        },
        { attemptId, reason: 'attempt' }
      )
    }
    ctx.recorder.transitionAttempt(attemptId, 'failed', { dispatchId, reason: 'worker_exited' })
    failed = true
  }
  return failed
}

/**
 * A rehydrated run whose host cannot be reached gets no controller until contact resumes, so no
 * sweep can run: its running workers are marked unverifiable here, from the DB alone.
 */
export function markHostUnreachableAttempts(db: OrchestrationDb, recorder: WorkflowRunRecorder) {
  for (const attempt of db.listWorkflowAttempts(recorder.runId)) {
    if (attempt.state === 'running' && attempt.dispatchId !== undefined) {
      recorder.transitionAttempt(attempt.id, 'unverifiable', {
        dispatchId: attempt.dispatchId,
        reason: 'host_unavailable'
      })
    }
  }
}

/**
 * When to sweep: at once for a rehydrated controller (the verdicts predate the restart), then one
 * interval after dispatched workers appear and every interval while any remain. While a sweep is
 * armed, deciding whether it is due reads no attempts.
 */
export class AttemptLivenessSchedule {
  private dueAt: number | undefined

  constructor(rehydrated: boolean) {
    this.dueAt = rehydrated ? 0 : undefined
  }

  isDue(ctx: WorkflowNodeLaunchContext, now = Date.now()): boolean {
    if (this.dueAt !== undefined) {
      return now >= this.dueAt
    }
    if (watchedAttempts(ctx).length > 0) {
      this.dueAt = now + ATTEMPT_LIVENESS_INTERVAL_MS
    }
    return false
  }

  /** The wake-up time the controller's idle wait should honor, if any. */
  nextAt(): number | undefined {
    return this.dueAt
  }

  async sweep(ctx: WorkflowNodeLaunchContext, engineRunId: string): Promise<ExitedAttempt[]> {
    const exited = await reconcileAttemptLiveness(ctx, engineRunId)
    this.dueAt =
      watchedAttempts(ctx).length > 0 ? Date.now() + ATTEMPT_LIVENESS_INTERVAL_MS : undefined
    return exited
  }
}
