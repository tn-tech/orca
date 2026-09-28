// A worker-dispatching attempt a stopped runtime left `pending`/`provisioning` would otherwise
// never dispatch and pin its run. Only this run's single controller calls it, between (never
// during) its launches. What happens depends on the Task's Dispatch:
// - active (pending/dispatched): adopted as `running` with what the worker start recorded;
// - settled (completed/failed/circuit_broken) with a worker_done in the Run mailbox: adopted, so
//   that report settles the attempt as it would have without the restart;
// - settled with no report: failed with the Dispatch's failure, as the dispatch path fails a
//   worker start that did not come up ready (no retry);
// - none: re-driven through the normal launch path, whose Task create replays by request id.
import { TERMINAL_RUN_STATES } from '../../../shared/workflows/workflow-node-states'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { DispatchContextRow } from '../orchestration/types'
import { dispatchBriefAttempt } from './workflow-brief-attempt-dispatch'
import {
  prepareBriefAttempt,
  requireBriefNode,
  WORKER_DISPATCH_NODE_TYPES,
  type WorkflowNodeLaunchContext
} from './workflow-run-node-launch'
import { parseWorkerStartResult, recordStartedWorker } from './workflow-worker-start-receipt'

const INTERRUPTED_STATES = new Set<NodeAttemptView['state']>(['pending', 'provisioning'])
const ACTIVE_DISPATCH_STATUSES = new Set<DispatchContextRow['status']>(['pending', 'dispatched'])

function isInterrupted(attempt: NodeAttemptView): boolean {
  return WORKER_DISPATCH_NODE_TYPES.has(attempt.nodeType) && INTERRUPTED_STATES.has(attempt.state)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseJson(text: string | null | undefined): unknown {
  try {
    return text ? JSON.parse(text) : undefined
  } catch {
    return undefined
  }
}

/** The worker row keeps the start's launch receipt and effects; read them as a start receipt. */
function persistedStartReceipt(ctx: WorkflowNodeLaunchContext, dispatchId: string): unknown {
  const worker = ctx.db.getWorkerDispatch(dispatchId)
  const startOptions = parseJson(worker?.start_options)
  const effects = parseJson(worker?.effects)
  return {
    dispatchId,
    launch: isRecord(startOptions) ? startOptions.launch : undefined,
    // The row's own worktree is the fallback when the crash came before its effects were written.
    effects: [
      ...(Array.isArray(effects) ? effects : []),
      ...(worker?.worktree_id ? [{ kind: 'worktree', id: worker.worktree_id }] : [])
    ]
  }
}

function hasWorkerReport(ctx: WorkflowNodeLaunchContext, dispatchId: string): boolean {
  const engineRun = ctx.db.getRunForWorkflowRun(ctx.recorder.runId)
  if (!engineRun) {
    return false
  }
  return ctx.db.getRunMailboxHistory(engineRun.id, 500, ['worker_done']).some((message) => {
    const payload = parseJson(message.payload)
    return isRecord(payload) && payload.dispatchId === dispatchId
  })
}

function adoptDispatch(
  ctx: WorkflowNodeLaunchContext,
  attempt: NodeAttemptView,
  dispatchId: string
) {
  const node = requireBriefNode(ctx.definition, attempt.nodeId)
  const childWorkspace = node.type === 'agent' && node.workspace === 'child'
  const parsed = parseWorkerStartResult(persistedStartReceipt(ctx, dispatchId))
  recordStartedWorker(ctx.db, attempt.id, { ...parsed, dispatchId }, childWorkspace)
  ctx.db.updateWorkflowAttempt(attempt.id, { transcriptRef: { kind: 'dispatch', id: dispatchId } })
  if (attempt.state === 'pending') {
    ctx.recorder.transitionAttempt(attempt.id, 'provisioning')
  }
  ctx.recorder.event(
    'attempt_dispatch_adopted',
    { dispatchId, fromState: attempt.state },
    { attemptId: attempt.id, reason: 'attempt' }
  )
  ctx.recorder.transitionAttempt(attempt.id, 'running', { dispatchId })
}

function failWithDispatch(
  ctx: WorkflowNodeLaunchContext,
  attempt: NodeAttemptView,
  dispatch: DispatchContextRow
): void {
  const failureReason =
    dispatch.last_failure ??
    ctx.db.getWorkerDispatch(dispatch.id)?.last_error ??
    `Worker Dispatch ${dispatch.id} ended (${dispatch.status}) before the restart without a report.`
  ctx.db.updateWorkflowAttempt(attempt.id, { failureReason, dispatchId: dispatch.id })
  if (attempt.state === 'pending') {
    ctx.recorder.transitionAttempt(attempt.id, 'provisioning')
  }
  ctx.recorder.transitionAttempt(attempt.id, 'failed', {
    dispatchId: dispatch.id,
    dispatchStatus: dispatch.status
  })
}

async function redrive(
  ctx: WorkflowNodeLaunchContext,
  attempt: NodeAttemptView,
  attempts: readonly NodeAttemptView[]
): Promise<void> {
  ctx.recorder.event(
    'attempt_redriven',
    { fromState: attempt.state },
    { attemptId: attempt.id, reason: 'attempt' }
  )
  const node = requireBriefNode(ctx.definition, attempt.nodeId)
  const taskId = attempt.taskId ?? (await prepareBriefAttempt(ctx, node, attempt, attempts))
  if (taskId) {
    await dispatchBriefAttempt(ctx, node, attempt.id, taskId, {
      resumeProvisioning: attempt.state === 'provisioning'
    })
  }
}

export async function recoverInterruptedAttempts(ctx: WorkflowNodeLaunchContext): Promise<void> {
  const attempts = ctx.db.listWorkflowAttempts(ctx.recorder.runId)
  for (const attempt of attempts.filter(isInterrupted)) {
    const state = ctx.db.getWorkflowRun(ctx.recorder.runId)?.state
    if (!state || TERMINAL_RUN_STATES.has(state) || ctx.signal?.aborted) {
      return
    }
    // Neither adopting nor failing dispatches anything, so a paused run still records them.
    const dispatch = attempt.taskId ? ctx.db.getDispatchContext(attempt.taskId) : undefined
    if (
      dispatch &&
      (ACTIVE_DISPATCH_STATUSES.has(dispatch.status) || hasWorkerReport(ctx, dispatch.id))
    ) {
      adoptDispatch(ctx, attempt, dispatch.id)
    } else if (dispatch) {
      failWithDispatch(ctx, attempt, dispatch)
    } else if (state !== 'paused') {
      await redrive(ctx, attempt, attempts)
    }
  }
}
