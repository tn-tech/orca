// Brings every agent question of a run up to date from persisted state on each controller pass
// (FR-033a, spec US5 AS6): due escalations and timeouts on the shared deadline scheduler, then
// the node of each timed-out question fails after its worker is asked to stop, then recorded
// answers reach the agent's existing session. Each step reads only the DB, so a runtime stopped
// between any two of them resumes on the next pass or rehydrate.
import type { NodeAttemptView, RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import {
  AGENT_QUESTION_TIMED_OUT_REASON,
  isAgentQuestion,
  openAgentQuestions
} from './workflow-agent-questions'
import { requestWorkerStop } from './workflow-join-branch-stop'
import {
  applyDueQuestionDeadlines,
  atomically,
  expireQuestion,
  type WorkflowQuestionListener
} from './workflow-question-deadlines'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'
import { leaveRunWaitIfClear } from './workflow-trust-wait'

type QuestionWithAttempt = { question: RunQuestionView; attempt: NodeAttemptView }

function agentQuestionsWithAttempts(ctx: WorkflowNodeLaunchContext): QuestionWithAttempt[] {
  const attempts = new Map(
    ctx.db.listWorkflowAttempts(ctx.recorder.runId).map((attempt) => [attempt.id, attempt])
  )
  return ctx.db
    .listWorkflowQuestions(ctx.recorder.runId)
    .filter(isAgentQuestion)
    .flatMap((question) => {
      const attempt = attempts.get(question.attemptId)
      return attempt ? [{ question, attempt }] : []
    })
}

/**
 * A question expired by its deadline leaves its attempt Waiting (every other expiry moves it on),
 * so a Waiting attempt with an expired question is one whose node still has to fail. Its Task is
 * left to the stop, as on a Join's stopped branches: orchestration refuses to fail a Task whose
 * worker an unconfirmed stop may have left running.
 */
async function failTimedOutQuestions(ctx: WorkflowNodeLaunchContext): Promise<boolean> {
  const timedOut = agentQuestionsWithAttempts(ctx).filter(
    ({ question, attempt }) => question.state === 'expired' && attempt.state === 'waiting'
  )
  const failed = new Set<string>()
  for (const { question, attempt } of timedOut) {
    if (failed.has(attempt.id)) {
      continue
    }
    failed.add(attempt.id)
    const stopped = await requestWorkerStop(ctx, attempt, {
      eventPrefix: 'agent_question_stop',
      reason: AGENT_QUESTION_TIMED_OUT_REASON,
      subject: { questionId: question.id }
    })
    atomically(ctx.db, () => {
      for (const open of openAgentQuestions(ctx.db, ctx.recorder.runId, attempt.id)) {
        expireQuestion(ctx.db, ctx.recorder, open, { reason: 'node_failed' })
      }
      ctx.db.updateWorkflowAttempt(attempt.id, { failureReason: AGENT_QUESTION_TIMED_OUT_REASON })
      ctx.recorder.transitionAttempt(attempt.id, 'running')
      ctx.recorder.transitionAttempt(attempt.id, 'failed', {
        questionId: question.id,
        workerStopped: stopped
      })
    })
  }
  return failed.size > 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Sends each recorded answer the orchestration thread still awaits through `orchestration.reply`
 * (engine consumer generation, `dispatch:<id>` wake, federated relay), then returns the attempt
 * to Running once none of its questions is open.
 */
async function deliverAnswers(ctx: WorkflowNodeLaunchContext): Promise<boolean> {
  let changed = false
  const resumed = new Set<string>()
  for (const { question, attempt } of agentQuestionsWithAttempts(ctx)) {
    if (question.state !== 'answered' || question.answer === undefined) {
      continue
    }
    const messageId = question.questionMessageId
    const thread = messageId ? ctx.db.getQuestion(messageId) : undefined
    if (messageId && thread?.status === 'pending') {
      const subject = { questionId: question.id, messageId }
      const options = { attemptId: attempt.id, reason: 'question' as const }
      try {
        await ctx.client.call('orchestration.reply', { id: messageId, body: question.answer })
        ctx.recorder.event('agent_question_delivered', subject, options)
      } catch (error) {
        const failure = { ...subject, error: errorMessage(error) }
        ctx.recorder.event('agent_question_delivery_failed', failure, options)
      }
      changed = true
    }
    if (
      attempt.state === 'waiting' &&
      attempt.dispatchId &&
      !resumed.has(attempt.id) &&
      openAgentQuestions(ctx.db, ctx.recorder.runId, attempt.id).length === 0
    ) {
      resumed.add(attempt.id)
      ctx.recorder.transitionAttempt(attempt.id, 'running', { questionId: question.id })
      changed = true
    }
  }
  return changed
}

/** `true` when anything changed, so the caller advances the frontier. */
export async function settleAgentQuestions(
  ctx: WorkflowNodeLaunchContext,
  options: { now?: number; onEscalated?: WorkflowQuestionListener } = {}
): Promise<boolean> {
  const timed = applyDueQuestionDeadlines(ctx, 'agent-question', options.now ?? Date.now(), {
    ...(options.onEscalated ? { onEscalated: options.onEscalated } : {}),
    timeOut: (question) => {
      expireQuestion(ctx.db, ctx.recorder, question)
    }
  })
  const failed = await failTimedOutQuestions(ctx)
  const delivered = await deliverAnswers(ctx)
  const changed = timed || failed || delivered
  if (changed) {
    leaveRunWaitIfClear(ctx.db, ctx.recorder)
  }
  return changed
}
