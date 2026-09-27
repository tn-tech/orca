// Approval timeouts (FR-033, spec US5 AS3), on the shared question deadline scheduler
// (workflow-question-deadlines.ts): at `timeoutAt` an approval answers with the node's
// `defaultOption`, or expires and fails the node when there is none.
import { approvalQuestionSubject } from '../../../shared/workflows/workflow-approval-question-subject'
import type { RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import {
  applyDueQuestionDeadlines,
  atomically,
  expireQuestion,
  type WorkflowQuestionListener
} from './workflow-question-deadlines'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'

export const APPROVAL_TIMED_OUT_REASON = 'approval_timed_out'
/** `answered_by` for an answer the engine applied from `defaultOption`, not a person. */
export const APPROVAL_DEFAULT_ANSWERER = 'workflow-engine:default-option'

export type WorkflowApprovalEscalationListener = WorkflowQuestionListener

function applyDefault(
  ctx: WorkflowNodeLaunchContext,
  question: RunQuestionView,
  defaultOption: string
): void {
  atomically(ctx.db, () => {
    // A person may have answered during an earlier await; the store keeps their answer.
    const answered = ctx.db.answerWorkflowQuestion(
      question.id,
      defaultOption,
      APPROVAL_DEFAULT_ANSWERER
    )
    if (answered?.answeredBy === APPROVAL_DEFAULT_ANSWERER) {
      ctx.recorder.event(
        'approval_default_applied',
        { questionId: question.id, option: defaultOption },
        { attemptId: question.attemptId, reason: 'question' }
      )
    }
  })
}

/**
 * Fails the node of every expired approval whose attempt is still open. A separate pass, so a
 * runtime stopped anywhere after the expiry resumes here on the next pass or rehydrate.
 */
async function failExpiredApprovals(ctx: WorkflowNodeLaunchContext): Promise<boolean> {
  const attempts = new Map(
    ctx.db.listWorkflowAttempts(ctx.recorder.runId).map((attempt) => [attempt.id, attempt])
  )
  let failed = false
  for (const question of ctx.db.listWorkflowQuestions(ctx.recorder.runId)) {
    const attempt = attempts.get(question.attemptId)
    if (
      question.kind !== 'approval' ||
      question.state !== 'expired' ||
      attempt?.nodeType !== 'approval' ||
      (attempt.state !== 'waiting' && attempt.state !== 'running')
    ) {
      continue
    }
    if (attempt.taskId && ctx.db.getTask(attempt.taskId)?.status !== 'failed') {
      await ctx.client.call('orchestration.taskUpdate', { id: attempt.taskId, status: 'failed' })
    }
    ctx.db.updateWorkflowAttempt(attempt.id, { failureReason: APPROVAL_TIMED_OUT_REASON })
    if (attempt.state === 'waiting') {
      ctx.recorder.transitionAttempt(attempt.id, 'running')
    }
    ctx.recorder.transitionAttempt(attempt.id, 'failed', { questionId: question.id })
    failed = true
  }
  return failed
}

/**
 * Applies every escalation and timeout that is due, then fails the nodes of expired approvals;
 * `true` when anything changed. A timed-out question with a default is left `answered` for the
 * answered-approval pass to route.
 */
export async function applyApprovalDeadlines(
  ctx: WorkflowNodeLaunchContext,
  now: number,
  onEscalated?: WorkflowApprovalEscalationListener
): Promise<boolean> {
  const changed = applyDueQuestionDeadlines(ctx, 'approval', now, {
    onEscalated,
    timeOut: (question) => {
      const defaultOption = approvalQuestionSubject(question)?.defaultOption
      if (defaultOption === undefined) {
        expireQuestion(ctx.db, ctx.recorder, question)
      } else {
        applyDefault(ctx, question, defaultOption)
      }
    }
  })
  return (await failExpiredApprovals(ctx)) || changed
}
