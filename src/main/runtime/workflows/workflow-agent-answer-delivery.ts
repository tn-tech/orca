// Delivers recorded agent-question answers to the agent's existing session through
// `orchestration.reply` (engine consumer generation, `dispatch:<id>` wake, federated relay), and
// returns a Waiting attempt to Running once its latest question's answer reached the agent.
// A refused delivery is not progress: it is retried with backoff on the run's deadline timer, so
// a persistent refusal never keeps the controller from reading its mailbox.
import type { NodeAttemptView, RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import { isAgentQuestion } from './workflow-agent-questions'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'

const FIRST_RETRY_MS = 1_000
const MAX_RETRY_MS = 60_000

/** Per-controller retry schedule; a restart simply retries at once. */
export class AgentAnswerDeliveryBackoff {
  private readonly retries = new Map<string, { failures: number; nextAt: number }>()

  isDue(questionId: string, now: number): boolean {
    return (this.retries.get(questionId)?.nextAt ?? now) <= now
  }

  recordFailure(questionId: string, now: number): void {
    const failures = (this.retries.get(questionId)?.failures ?? 0) + 1
    const delay = Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS)
    this.retries.set(questionId, { failures, nextAt: now + delay })
  }

  clear(questionId: string): void {
    this.retries.delete(questionId)
  }

  /** Drops every question no longer awaiting delivery, so a stale retry never re-arms a wake. */
  retainOnly(questionIds: ReadonlySet<string>): void {
    for (const questionId of this.retries.keys()) {
      if (!questionIds.has(questionId)) {
        this.retries.delete(questionId)
      }
    }
  }

  nextRetryAt(): number | undefined {
    const times = [...this.retries.values()].map((retry) => retry.nextAt)
    return times.length > 0 ? Math.min(...times) : undefined
  }
}

/** Each dispatched Waiting attempt with the agent question it currently waits on (its latest). */
export function latestAgentQuestions(
  ctx: WorkflowNodeLaunchContext
): { question: RunQuestionView; attempt: NodeAttemptView }[] {
  const waiting = new Map(
    ctx.db
      .listWorkflowAttempts(ctx.recorder.runId)
      .filter((attempt) => attempt.state === 'waiting' && attempt.dispatchId)
      .map((attempt) => [attempt.id, attempt])
  )
  const latest = new Map<string, RunQuestionView>()
  // Rowid order, so the last one seen per attempt is its latest.
  for (const question of ctx.db.listWorkflowQuestions(ctx.recorder.runId)) {
    if (isAgentQuestion(question) && waiting.has(question.attemptId)) {
      latest.set(question.attemptId, question)
    }
  }
  return [...latest].flatMap(([attemptId, question]) => {
    const attempt = waiting.get(attemptId)
    return attempt ? [{ question, attempt }] : []
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `true` only for real progress: an answer delivered or an attempt resumed. */
export async function deliverAgentAnswers(
  ctx: WorkflowNodeLaunchContext,
  backoff: AgentAnswerDeliveryBackoff,
  now: number
): Promise<boolean> {
  let changed = false
  const answered = latestAgentQuestions(ctx).filter(
    ({ question }) =>
      question.state === 'answered' && question.answer !== undefined && question.questionMessageId
  )
  const pending = answered.filter(
    ({ question }) => ctx.db.getQuestion(question.questionMessageId ?? '')?.status === 'pending'
  )
  backoff.retainOnly(new Set(pending.map(({ question }) => question.id)))
  for (const { question, attempt } of answered) {
    const messageId = question.questionMessageId
    if (question.answer === undefined || !messageId) {
      continue
    }
    if (pending.some((entry) => entry.question.id === question.id)) {
      if (!backoff.isDue(question.id, now)) {
        continue
      }
      const subject = { questionId: question.id, messageId }
      const options = { attemptId: attempt.id, reason: 'question' as const }
      try {
        await ctx.client.call('orchestration.reply', { id: messageId, body: question.answer })
      } catch (error) {
        backoff.recordFailure(question.id, now)
        ctx.recorder.event(
          'agent_question_delivery_failed',
          { ...subject, error: errorMessage(error) },
          options
        )
        continue
      }
      backoff.clear(question.id)
      ctx.recorder.event('agent_question_delivered', subject, options)
    }
    // Delivered now or earlier, or the thread closed with its Dispatch: nothing left to wait on.
    ctx.recorder.transitionAttempt(attempt.id, 'running', { questionId: question.id })
    changed = true
  }
  return changed
}
