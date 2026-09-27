// Approval timeouts (FR-033, spec US5 AS3). Deadlines live on the question row, never only in a
// timer, so a restarted runtime applies whatever came due while it was down: `escalationAt`
// (raise + timeoutMs) escalates, `timeoutAt` (escalationAt + escalationGraceMs) then answers with
// the node's `defaultOption`, or expires the question and fails the node when there is none.
import { approvalQuestionSubject } from '../../../shared/workflows/workflow-approval-question-subject'
import type { RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'

// Why: setTimeout fires at once past 2^31-1 ms, which would spin on a long approval timeout.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

export const APPROVAL_TIMED_OUT_REASON = 'approval_timed_out'
/** `answered_by` for an answer the engine applied from `defaultOption`, not a person. */
export const APPROVAL_DEFAULT_ANSWERER = 'workflow-engine:default-option'

/** Seam for the `workflow-attention` escalation notification; run and change events always fire. */
export type WorkflowApprovalEscalationListener = (question: RunQuestionView) => void

export function approvalDeadlines(
  raisedAt: number,
  node: { timeoutMs: number; escalationGraceMs: number }
): { escalationAt: number; timeoutAt: number } {
  const escalationAt = raisedAt + node.timeoutMs
  return { escalationAt, timeoutAt: escalationAt + node.escalationGraceMs }
}

function openApprovalQuestions(db: OrchestrationDb, runId: string): RunQuestionView[] {
  return db.listOpenWorkflowQuestions(runId).filter((question) => question.kind === 'approval')
}

function millis(iso: string | undefined): number | undefined {
  return iso === undefined ? undefined : Date.parse(iso)
}

function isDue(iso: string | undefined, now: number): boolean {
  const at = millis(iso)
  return at !== undefined && at <= now
}

/** The next moment an open approval of this run escalates or times out. */
export function nextApprovalDeadline(db: OrchestrationDb, runId: string): number | undefined {
  const deadlines = openApprovalQuestions(db, runId)
    .map((question) =>
      millis(question.state === 'pending' ? question.escalationAt : question.timeoutAt)
    )
    .filter((at): at is number => at !== undefined)
  return deadlines.length > 0 ? Math.min(...deadlines) : undefined
}

/**
 * Calls `wake` at the run's next approval deadline; returns the disarm function. Re-armed from
 * the DB on every controller pass, so nothing depends on a timer surviving a restart.
 */
export function armApprovalDeadlineTimer(
  db: OrchestrationDb,
  runId: string,
  wake: () => void
): () => void {
  const deadline = nextApprovalDeadline(db, runId)
  if (deadline === undefined) {
    return () => {}
  }
  const timer = setTimeout(wake, Math.min(Math.max(0, deadline - Date.now()), MAX_TIMER_DELAY_MS))
  return () => clearTimeout(timer)
}

function escalate(
  ctx: WorkflowNodeLaunchContext,
  question: RunQuestionView,
  onEscalated: WorkflowApprovalEscalationListener | undefined
): void {
  const escalated = ctx.db.escalateWorkflowQuestion(question.id)
  if (escalated?.state !== 'escalated') {
    return
  }
  ctx.recorder.event(
    'approval_escalated',
    { questionId: question.id, ...(escalated.timeoutAt ? { timeoutAt: escalated.timeoutAt } : {}) },
    { attemptId: question.attemptId, reason: 'question' }
  )
  onEscalated?.(escalated)
}

async function expire(ctx: WorkflowNodeLaunchContext, question: RunQuestionView): Promise<void> {
  if (ctx.db.expireWorkflowQuestion(question.id)?.state !== 'expired') {
    return
  }
  // Why direct: orchestration has no gate-timeout RPC; the engine owns this Run's gates.
  if (question.gateId) {
    ctx.db.timeoutGate(question.gateId)
  }
  const attempt = ctx.db
    .listWorkflowAttempts(ctx.recorder.runId)
    .find((candidate) => candidate.id === question.attemptId)
  if (attempt?.state === 'waiting' || attempt?.state === 'running') {
    if (attempt.taskId && ctx.db.getTask(attempt.taskId)?.status !== 'failed') {
      await ctx.client.call('orchestration.taskUpdate', { id: attempt.taskId, status: 'failed' })
    }
    ctx.db.updateWorkflowAttempt(attempt.id, { failureReason: APPROVAL_TIMED_OUT_REASON })
    if (attempt.state === 'waiting') {
      ctx.recorder.transitionAttempt(attempt.id, 'running')
    }
    ctx.recorder.transitionAttempt(attempt.id, 'failed', { questionId: question.id })
  }
  ctx.recorder.event(
    'approval_expired',
    { questionId: question.id },
    { attemptId: question.attemptId, reason: 'question' }
  )
}

/**
 * Applies every escalation and timeout that is due; `true` when anything changed. A timed-out
 * question with a default is left `answered` for the answered-approval pass to route.
 */
export async function applyApprovalDeadlines(
  ctx: WorkflowNodeLaunchContext,
  now: number,
  onEscalated?: WorkflowApprovalEscalationListener
): Promise<boolean> {
  let changed = false
  for (const question of openApprovalQuestions(ctx.db, ctx.recorder.runId)) {
    // Escalation always precedes the default, even when both came due while the runtime was down.
    if (question.state === 'pending' && isDue(question.escalationAt, now)) {
      escalate(ctx, question, onEscalated)
      changed = true
    }
    if (!isDue(question.timeoutAt, now)) {
      continue
    }
    changed = true
    const defaultOption = approvalQuestionSubject(question)?.defaultOption
    if (defaultOption === undefined) {
      await expire(ctx, question)
      continue
    }
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
  }
  return changed
}
