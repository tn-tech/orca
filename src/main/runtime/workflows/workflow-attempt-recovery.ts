// A worker-dispatching attempt a stopped runtime left `pending`/`provisioning` would otherwise
// never dispatch and pin its run. One whose Task already has a Dispatch is adopted, never started
// twice; the rest are re-driven through the normal launch path, whose Task create replays by
// request id. Only this run's single controller calls it, between (never during) its launches.
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { dispatchBriefAttempt } from './workflow-brief-attempt-dispatch'
import {
  prepareBriefAttempt,
  requireBriefNode,
  WORKER_DISPATCH_NODE_TYPES,
  type WorkflowNodeLaunchContext
} from './workflow-run-node-launch'

const INTERRUPTED_STATES = new Set<NodeAttemptView['state']>(['pending', 'provisioning'])
const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled'])

function isInterrupted(attempt: NodeAttemptView): boolean {
  return WORKER_DISPATCH_NODE_TYPES.has(attempt.nodeType) && INTERRUPTED_STATES.has(attempt.state)
}

/** The host accepted the worker before the restart; the attempt only missed recording it. */
function adoptDispatch(
  ctx: WorkflowNodeLaunchContext,
  attempt: NodeAttemptView,
  dispatchId: string
): void {
  ctx.db.updateWorkflowAttempt(attempt.id, {
    dispatchId,
    transcriptRef: { kind: 'dispatch', id: dispatchId }
  })
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

export async function recoverInterruptedAttempts(ctx: WorkflowNodeLaunchContext): Promise<void> {
  const readRunState = () => ctx.db.getWorkflowRun(ctx.recorder.runId)?.state
  const attempts = ctx.db.listWorkflowAttempts(ctx.recorder.runId)
  for (const attempt of attempts.filter(isInterrupted)) {
    const state = readRunState()
    if (!state || TERMINAL_RUN_STATES.has(state) || ctx.signal?.aborted) {
      return
    }
    // Adopting is not a new dispatch, so a paused run still records it.
    const dispatch = attempt.taskId ? ctx.db.getDispatchContext(attempt.taskId) : undefined
    if (dispatch) {
      adoptDispatch(ctx, attempt, dispatch.id)
      continue
    }
    if (state === 'paused') {
      continue
    }
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
}
