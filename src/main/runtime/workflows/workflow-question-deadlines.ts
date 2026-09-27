// The one deadline scheduler for questions a person must answer during a run: approvals (FR-033)
// and agent questions (FR-033a). Deadlines live on the question row, never only in a timer, so a
// restarted runtime applies whatever came due while it was down: `escalationAt` (raise + timeout)
// escalates, `timeoutAt` (escalationAt + grace) then times the question out. What a timeout means
// is the caller's: an approval applies its default or fails, an agent question fails its node.
import type { RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'
import type { WorkflowEventPayload, WorkflowRunRecorder } from './workflow-run-recorder'

// Why: setTimeout fires at once past 2^31-1 ms, which would spin on a long timeout.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

export type DeadlineQuestionKind = 'approval' | 'agent-question'

const EVENT_PREFIX: Record<DeadlineQuestionKind, string> = {
  approval: 'approval',
  'agent-question': 'agent_question'
}

/** Seam for the `workflow-attention` notification; run and change events always fire. */
export type WorkflowQuestionListener = (question: RunQuestionView) => void

export function questionDeadlines(
  raisedAt: number,
  timing: { timeoutMs: number; escalationGraceMs: number }
): { escalationAt: number; timeoutAt: number } {
  const escalationAt = raisedAt + timing.timeoutMs
  return { escalationAt, timeoutAt: escalationAt + timing.escalationGraceMs }
}

function isDeadlineKind(kind: RunQuestionView['kind']): kind is DeadlineQuestionKind {
  return kind === 'approval' || kind === 'agent-question'
}

function openDeadlineQuestions(
  db: OrchestrationDb,
  runId: string,
  kind?: DeadlineQuestionKind
): (RunQuestionView & { kind: DeadlineQuestionKind })[] {
  return db
    .listOpenWorkflowQuestions(runId)
    .filter(
      (question): question is RunQuestionView & { kind: DeadlineQuestionKind } =>
        isDeadlineKind(question.kind) && (kind === undefined || question.kind === kind)
    )
}

function millis(iso: string | undefined): number | undefined {
  return iso === undefined ? undefined : Date.parse(iso)
}

function isDue(iso: string | undefined, now: number): boolean {
  const at = millis(iso)
  return at !== undefined && at <= now
}

/** The next moment an open question of this run escalates or times out. */
export function nextQuestionDeadline(db: OrchestrationDb, runId: string): number | undefined {
  const deadlines = openDeadlineQuestions(db, runId)
    .map((question) =>
      millis(question.state === 'pending' ? question.escalationAt : question.timeoutAt)
    )
    .filter((at): at is number => at !== undefined)
  return deadlines.length > 0 ? Math.min(...deadlines) : undefined
}

/**
 * Calls `wake` at the run's next question deadline (or `alsoAt`, e.g. a delivery retry, if
 * sooner); returns the disarm function. Re-armed from the DB on every controller pass, so nothing
 * depends on a timer surviving a restart.
 */
export function armQuestionDeadlineTimer(
  db: OrchestrationDb,
  runId: string,
  wake: () => void,
  alsoAt?: number
): () => void {
  const deadlines = [nextQuestionDeadline(db, runId), alsoAt].filter(
    (at): at is number => at !== undefined
  )
  const deadline = deadlines.length > 0 ? Math.min(...deadlines) : undefined
  if (deadline === undefined) {
    return () => {}
  }
  const timer = setTimeout(wake, Math.min(Math.max(0, deadline - Date.now()), MAX_TIMER_DELAY_MS))
  return () => clearTimeout(timer)
}

// Why one transaction: a stop between the state write and its event must not lose the event.
export function atomically(db: OrchestrationDb, write: () => void): void {
  db.db.exec('SAVEPOINT workflow_question_step')
  try {
    write()
    db.db.exec('RELEASE workflow_question_step')
  } catch (error) {
    db.db.exec('ROLLBACK TO workflow_question_step')
    db.db.exec('RELEASE workflow_question_step')
    throw error
  }
}

function escalate(
  ctx: WorkflowNodeLaunchContext,
  question: RunQuestionView & { kind: DeadlineQuestionKind },
  onEscalated: WorkflowQuestionListener | undefined
): void {
  let escalated: RunQuestionView | undefined
  atomically(ctx.db, () => {
    escalated = ctx.db.escalateWorkflowQuestion(question.id)
    if (escalated?.state === 'escalated') {
      ctx.recorder.event(
        `${EVENT_PREFIX[question.kind]}_escalated`,
        {
          questionId: question.id,
          ...(escalated.timeoutAt ? { timeoutAt: escalated.timeoutAt } : {})
        },
        { attemptId: question.attemptId, reason: 'question' }
      )
    }
  })
  if (escalated?.state === 'escalated') {
    onEscalated?.(escalated)
  }
}

/** Claims the question as expired (a gate it mirrors times out with it); `false` if already settled. */
export function expireQuestion(
  db: OrchestrationDb,
  recorder: WorkflowRunRecorder,
  question: RunQuestionView & { kind: DeadlineQuestionKind },
  payload: WorkflowEventPayload = {}
): boolean {
  let expired = false
  atomically(db, () => {
    if (db.expireWorkflowQuestion(question.id)?.state !== 'expired') {
      return
    }
    // Why direct: orchestration has no gate-timeout RPC; the engine owns this Run's gates.
    if (question.gateId) {
      db.timeoutGate(question.gateId)
    }
    recorder.event(
      `${EVENT_PREFIX[question.kind]}_expired`,
      { questionId: question.id, ...payload },
      { attemptId: question.attemptId, reason: 'question' }
    )
    expired = true
  })
  return expired
}

/** A finished run's open questions can no longer be answered; clients stop showing them. */
export function closeOpenQuestions(db: OrchestrationDb, recorder: WorkflowRunRecorder): void {
  for (const question of openDeadlineQuestions(db, recorder.runId)) {
    expireQuestion(db, recorder, question, { reason: 'run_ended' })
  }
}

/** An ended attempt's agent questions can no longer reach its agent; close them with it. */
export function closeAttemptAgentQuestions(
  db: OrchestrationDb,
  recorder: WorkflowRunRecorder,
  attemptId: string,
  reason: string
): void {
  for (const question of openDeadlineQuestions(db, recorder.runId, 'agent-question')) {
    if (question.attemptId === attemptId) {
      expireQuestion(db, recorder, question, { reason })
    }
  }
}

/**
 * Applies every due escalation of `kind`, then hands each question past its final deadline to
 * `timeOut`; `true` when anything changed. Escalation always precedes the timeout, even when both
 * came due while the runtime was down.
 */
export function applyDueQuestionDeadlines(
  ctx: WorkflowNodeLaunchContext,
  kind: DeadlineQuestionKind,
  now: number,
  options: {
    onEscalated?: WorkflowQuestionListener
    timeOut(question: RunQuestionView & { kind: DeadlineQuestionKind }): void
  }
): boolean {
  let changed = false
  for (const question of openDeadlineQuestions(ctx.db, ctx.recorder.runId, kind)) {
    if (question.state === 'pending' && isDue(question.escalationAt, now)) {
      escalate(ctx, question, options.onEscalated)
      changed = true
    }
    if (isDue(question.timeoutAt, now)) {
      options.timeOut(question)
      changed = true
    }
  }
  return changed
}
