// Decides what one Run-mailbox message means to a workflow run. Any terminal can post to
// run:<engineRunId>, so only mail sent by one of this run's own Dispatches is acted on.
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { MessageRow, WorkerReportOutcome } from '../orchestration/types'

export type RunMailIgnoredReason = 'foreign_sender' | 'lifecycle_rejected' | 'invalid_payload'

export type RunMail =
  | {
      kind: 'worker_done'
      attempt: NodeAttemptView
      dispatchId: string
      outcome: WorkerReportOutcome
      reportPath: string | null
    }
  /** `orchestration ask` from one of this run's Dispatches (FR-033a). */
  | {
      kind: 'question'
      attempt: NodeAttemptView & { dispatchId: string }
      prompt: string
      options: string[]
    }
  /** Own-Dispatch mail no handler consumes yet. */
  | { kind: 'deferred'; attempt: NodeAttemptView }
  | { kind: 'ignored'; reason: RunMailIgnoredReason }

function parsePayload(payload: string | null): Record<string, unknown> {
  if (!payload) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(payload)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  } catch {
    return {}
  }
}

function isSentByDispatch(db: OrchestrationDb, dispatchId: string, message: MessageRow): boolean {
  const dispatch = db.getDispatchContextById(dispatchId)
  if (!dispatch) {
    return false
  }
  if (dispatch.assignee_pane_key && message.sender_pane_key) {
    return dispatch.assignee_pane_key === message.sender_pane_key
  }
  return dispatch.assignee_handle === message.from_handle
}

export function classifyRunMail(
  db: OrchestrationDb,
  message: MessageRow,
  attempts: readonly NodeAttemptView[]
): RunMail {
  const payload = parsePayload(message.payload)
  // A rejected lifecycle message keeps its type; the marker says the host refused it.
  if (payload._orcaLifecycleRejection !== undefined) {
    return { kind: 'ignored', reason: 'lifecycle_rejected' }
  }
  const dispatched = attempts.filter(
    (attempt): attempt is NodeAttemptView & { dispatchId: string } =>
      attempt.dispatchId !== undefined
  )
  if (message.type === 'question') {
    // Why the thread, not the sender: ask files the message as `dispatch:<id>` after verifying
    // the Dispatch capability, and only ask (or a federated relay of it) creates the thread.
    const thread = db.getQuestion(message.id)
    const attempt = thread
      ? dispatched.find((candidate) => candidate.dispatchId === thread.dispatch_id)
      : undefined
    if (!thread || !attempt || thread.run_id !== message.run_id) {
      return { kind: 'ignored', reason: 'foreign_sender' }
    }
    const options = Array.isArray(payload.options)
      ? payload.options.filter((option): option is string => typeof option === 'string')
      : []
    return { kind: 'question', attempt, prompt: message.body, options }
  }
  if (message.type !== 'worker_done') {
    const sender = dispatched.find((attempt) => isSentByDispatch(db, attempt.dispatchId, message))
    return sender
      ? { kind: 'deferred', attempt: sender }
      : { kind: 'ignored', reason: 'foreign_sender' }
  }
  const attempt = dispatched.find((candidate) => candidate.dispatchId === payload.dispatchId)
  if (!attempt || !isSentByDispatch(db, attempt.dispatchId, message)) {
    return { kind: 'ignored', reason: 'foreign_sender' }
  }
  const outcome = payload.outcome
  if (outcome !== 'succeeded' && outcome !== 'failed') {
    return { kind: 'ignored', reason: 'invalid_payload' }
  }
  return {
    kind: 'worker_done',
    attempt,
    dispatchId: attempt.dispatchId,
    outcome,
    reportPath: typeof payload.reportPath === 'string' ? payload.reportPath : null
  }
}
