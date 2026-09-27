// Brings every agent question of a run up to date from persisted state on each controller pass
// (FR-033a, spec US5 AS6): due escalations and timeouts on the shared deadline scheduler, then
// the node of each timed-out question fails after its worker is asked to stop, then recorded
// answers reach the agent's existing session. Each step reads only the DB, so a runtime stopped
// between any two of them resumes on the next pass or rehydrate.
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import {
  type AgentAnswerDeliveryBackoff,
  deliverAgentAnswers,
  latestAgentQuestions
} from './workflow-agent-answer-delivery'
import { AGENT_QUESTION_TIMED_OUT_REASON } from './workflow-agent-questions'
import { requestWorkerStop } from './workflow-join-branch-stop'
import {
  applyDueQuestionDeadlines,
  atomically,
  expireQuestion,
  type WorkflowQuestionListener
} from './workflow-question-deadlines'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'
import { leaveRunWaitIfClear } from './workflow-trust-wait'
import { ensureTaskStatus } from './workflow-worker-done'

/**
 * A Waiting attempt whose latest question expired by its deadline still has to fail: every other
 * expiry either moves the attempt on or (superseded) is never the latest. Only after a confirmed
 * stop is its Task failed; orchestration refuses while the worker may still be running.
 */
async function failTimedOutQuestions(ctx: WorkflowNodeLaunchContext): Promise<boolean> {
  const timedOut = latestAgentQuestions(ctx).filter(({ question }) => question.state === 'expired')
  for (const { question, attempt } of timedOut) {
    const stopped = await requestWorkerStop(ctx, attempt, {
      eventPrefix: 'agent_question_stop',
      reason: AGENT_QUESTION_TIMED_OUT_REASON,
      subject: { questionId: question.id }
    })
    if (stopped) {
      await failStoppedTask(ctx, attempt, question.id)
    }
    atomically(ctx.db, () => {
      ctx.db.updateWorkflowAttempt(attempt.id, { failureReason: AGENT_QUESTION_TIMED_OUT_REASON })
      ctx.recorder.transitionAttempt(attempt.id, 'running')
      ctx.recorder.transitionAttempt(attempt.id, 'failed', {
        questionId: question.id,
        workerStopped: stopped
      })
    })
  }
  return timedOut.length > 0
}

async function failStoppedTask(
  ctx: WorkflowNodeLaunchContext,
  attempt: NodeAttemptView,
  questionId: string
): Promise<void> {
  try {
    await ensureTaskStatus(ctx, attempt.taskId, 'failed')
  } catch (error) {
    ctx.recorder.event(
      'agent_question_task_update_failed',
      { questionId, error: error instanceof Error ? error.message : String(error) },
      { attemptId: attempt.id, reason: 'attempt' }
    )
  }
}

/** `true` when anything changed, so the caller advances the frontier. */
export async function settleAgentQuestions(
  ctx: WorkflowNodeLaunchContext,
  options: {
    now?: number
    onEscalated?: WorkflowQuestionListener
    deliveryBackoff: AgentAnswerDeliveryBackoff
  }
): Promise<boolean> {
  const now = options.now ?? Date.now()
  const timed = applyDueQuestionDeadlines(ctx, 'agent-question', now, {
    ...(options.onEscalated ? { onEscalated: options.onEscalated } : {}),
    timeOut: (question) => {
      expireQuestion(ctx.db, ctx.recorder, question)
    }
  })
  const failed = await failTimedOutQuestions(ctx)
  const delivered = await deliverAgentAnswers(ctx, options.deliveryBackoff, now)
  const changed = timed || failed || delivered
  if (changed) {
    leaveRunWaitIfClear(ctx.db, ctx.recorder)
  }
  return changed
}
