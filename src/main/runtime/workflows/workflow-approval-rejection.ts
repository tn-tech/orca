// An Approval answered with an option that has no outgoing edge stops the whole run (spec US5:
// "follows the rejection edge if one exists or stops the run"). Live workers are asked to stop
// through the Join-fail stop path, every other active attempt is cancelled, and the run fails
// with `approval_rejected`. Nodes that never started get no attempt: the run is terminal.
import { ACTIVE_ATTEMPT_STATES } from '../../../shared/workflows/workflow-node-states'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { stopWorkerAttempt } from './workflow-join-branch-stop'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'

export const APPROVAL_REJECTED_REASON = 'approval_rejected'

export function approvalOptionHasEdge(
  ctx: WorkflowNodeLaunchContext,
  nodeId: string,
  option: string
): boolean {
  return ctx.definition.edges.some((edge) => edge.from === nodeId && edge.fromPort === option)
}

export async function stopRunForApproval(
  ctx: WorkflowNodeLaunchContext,
  approval: NodeAttemptView,
  option: string
): Promise<void> {
  const subject = { approvalNodeId: approval.nodeId, option }
  ctx.recorder.event('approval_run_stopping', subject, { attemptId: approval.id })
  const active = ctx.db
    .listWorkflowAttempts(ctx.recorder.runId)
    .filter((attempt) => attempt.id !== approval.id && ACTIVE_ATTEMPT_STATES.has(attempt.state))
  const workers = active.filter((attempt) => attempt.dispatchId !== undefined)
  for (const attempt of active.filter((candidate) => candidate.dispatchId === undefined)) {
    ctx.recorder.transitionAttempt(attempt.id, 'cancelled', {
      reason: APPROVAL_REJECTED_REASON,
      ...subject
    })
  }
  const cause = { eventPrefix: 'approval_stop', reason: APPROVAL_REJECTED_REASON, subject }
  await Promise.all(workers.map((attempt) => stopWorkerAttempt(ctx, attempt, cause)))
  ctx.recorder.transitionRun('failed', 'run_failed', {
    reason: APPROVAL_REJECTED_REASON,
    nodeId: approval.nodeId,
    option
  })
}
