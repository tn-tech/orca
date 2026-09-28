// Maps each dispatched attempt's worker-list liveness verdict (live / unverifiable / exited) onto
// the attempt (FR-032, docs/reference/ssh-execution-boundary.md): anything short of `live` makes a
// running attempt `unverifiable`, `live` returns it to `running`, and `exited` changes nothing
// here — the worker's own report settles it, and silence is never read as an exit.
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'

/** How often a run with dispatched workers re-reads their verdicts while otherwise idle. */
export const ATTEMPT_LIVENESS_INTERVAL_MS = 60_000

const WATCHED_STATES = new Set<NodeAttemptView['state']>(['running', 'unverifiable'])

type LivenessReading =
  | { verdict: 'live' }
  | { verdict: 'exited' }
  | { verdict: 'unverifiable'; reason: string }

type WatchedAttempt = NodeAttemptView & { dispatchId: string }

function watchedAttempts(ctx: WorkflowNodeLaunchContext): WatchedAttempt[] {
  return ctx.db
    .listWorkflowAttempts(ctx.recorder.runId)
    .filter(
      (attempt): attempt is WatchedAttempt =>
        WATCHED_STATES.has(attempt.state) && attempt.dispatchId !== undefined
    )
}

/** True while the run has a dispatched worker whose liveness the sweep should keep reading. */
export function hasWatchedAttempts(ctx: WorkflowNodeLaunchContext): boolean {
  return watchedAttempts(ctx).length > 0
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
  engineRunId: string
): Promise<Map<string, LivenessReading> | undefined> {
  try {
    return readVerdicts(
      await ctx.client.call('orchestration.workerList', { run: engineRunId, includeRemote: true })
    )
  } catch {
    // Could not ask: that observes nothing about the workers, so every one is unverifiable.
    return undefined
  }
}

/** One sweep over the run's dispatched attempts; never throws into the controller. */
export async function reconcileAttemptLiveness(
  ctx: WorkflowNodeLaunchContext,
  engineRunId: string
): Promise<void> {
  if (!hasWatchedAttempts(ctx)) {
    return
  }
  const readings = await readRunLiveness(ctx, engineRunId)
  if (ctx.signal?.aborted) {
    return
  }
  // Re-read: a worker_done or question may have settled an attempt while worker-list ran.
  for (const attempt of watchedAttempts(ctx)) {
    const reading: LivenessReading = readings
      ? (readings.get(attempt.dispatchId) ?? { verdict: 'unverifiable', reason: 'not_listed' })
      : { verdict: 'unverifiable', reason: 'liveness_unreadable' }
    if (reading.verdict === 'unverifiable' && attempt.state === 'running') {
      ctx.recorder.transitionAttempt(attempt.id, 'unverifiable', {
        dispatchId: attempt.dispatchId,
        reason: reading.reason
      })
    } else if (reading.verdict === 'live' && attempt.state === 'unverifiable') {
      ctx.recorder.transitionAttempt(attempt.id, 'running', {
        dispatchId: attempt.dispatchId,
        reason: 'liveness_confirmed'
      })
    }
  }
}

/**
 * When to sweep: at once for a rehydrated controller (the verdicts predate the restart), then one
 * interval after dispatched workers appear and every interval while any remain.
 */
export class AttemptLivenessSchedule {
  private dueAt: number | undefined

  constructor(rehydrated: boolean) {
    this.dueAt = rehydrated ? 0 : undefined
  }

  /** Arms the first sweep one interval after dispatched workers appear; clears it when none remain. */
  isDue(ctx: WorkflowNodeLaunchContext, now = Date.now()): boolean {
    if (!hasWatchedAttempts(ctx)) {
      this.dueAt = undefined
      return false
    }
    this.dueAt ??= now + ATTEMPT_LIVENESS_INTERVAL_MS
    return now >= this.dueAt
  }

  /** The wake-up time the controller's idle wait should honor, if any. */
  nextAt(): number | undefined {
    return this.dueAt
  }

  async sweep(ctx: WorkflowNodeLaunchContext, engineRunId: string): Promise<void> {
    await reconcileAttemptLiveness(ctx, engineRunId)
    this.dueAt = Date.now() + ATTEMPT_LIVENESS_INTERVAL_MS
  }
}
