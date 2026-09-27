// Follow-up messages to a running node's agent (FR-036/FR-036a, spec US5 AS6a, research R8). A
// person's message is recorded `queued` on the attempt (queueFollowUp) and wakes the run; the
// controller then works it on each pass.
//
// Queued mode goes through `orchestration.send` to `dispatch:<id>` under a request id derived from
// the message, so a send replayed after a crash returns the first receipt instead of a second
// mail. The mail's id is recorded in a `follow_up_sent` event and the row stays `queued` until the
// agent's next checkpoint receives it: only then `delivered`.
// "Interrupt now" writes into the worker's session (workflow-follow-up-interrupt.ts) and is
// `delivered` once the host accepted it. Anything unconfirmed (an unreachable SSH host, an
// unsettled send) stays queued and is retried with backoff; a message whose attempt ended first
// fails. Terminal interrupts are at-least-once: a crash after the paste but before the row is
// updated pastes it again on the next pass.
//
// "Received" (delivered) means the agent's checkpoint got the mail: a worker `check` claimed it in
// a mailbox delivery, or the delivery was acknowledged (read). When the attempt or run ends, a
// final receipt check settles sent mail as delivered or failed `not_received`. Failure reasons on
// `follow_up_undeliverable`: `not_received`, `not_submitted`, `agent_session_send_rejected`,
// `attempt_<state>`, `attempt_missing`, `run_ended`.
import type {
  NodeAttemptView,
  RunMessageView,
  WorkflowMessageMode
} from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { AgentAnswerDeliveryBackoff } from './workflow-agent-answer-delivery'
import { engineCoordinatorHandle } from './workflow-engine-principal'
import {
  readPath,
  sendInterrupt,
  type FollowUpInterruptPorts,
  type FollowUpOutcome,
  type FollowUpWorker
} from './workflow-follow-up-interrupt'
import type { WorkflowOrchestrationClient } from './workflow-orchestration-client'
import { atomically } from './workflow-question-deadlines'
import { WorkflowRunRecorder, type WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { wakeWorkflowRun } from './workflow-run-wake'

export { resolveFollowUpWorker, type FollowUpWorker } from './workflow-follow-up-interrupt'

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled'])
const ENDED_ATTEMPT_STATES = new Set<NodeAttemptView['state']>([
  'completed',
  'failed',
  'skipped',
  'cancelled'
])
// FR-036 "a running node's agent"; unverifiable is a running worker whose host went quiet.
const MESSAGEABLE_ATTEMPT_STATES = new Set<NodeAttemptView['state']>(['running', 'unverifiable'])
const SENT_EVENT = 'follow_up_sent'
const FAILED_EVENT = 'follow_up_delivery_failed'

export type FollowUpDeliveryContext = FollowUpInterruptPorts & {
  db: OrchestrationDb
  recorder: WorkflowRunRecorder
  client: WorkflowOrchestrationClient
  resolveWorker(dispatchId: string): FollowUpWorker | undefined
  backoff: AgentAnswerDeliveryBackoff
}

function invalid(message: string, data: Record<string, string>): OrchestrationError {
  return new OrchestrationError('invalid_argument', message, data)
}

/** Records a person's follow-up on a running node attempt and wakes the run to deliver it. */
export function queueFollowUp(
  db: OrchestrationDb,
  notifier: WorkflowRunChangeNotifier,
  args: {
    runId: string
    attemptId: string
    text: string
    mode: WorkflowMessageMode
    sender: string
  }
): RunMessageView {
  const { runId, attemptId, text, mode, sender } = args
  const state = db.getWorkflowRun(runId)?.state
  if (state === undefined) {
    throw new Error('workflow_not_found')
  }
  if (TERMINAL_RUN_STATES.has(state)) {
    throw new OrchestrationError('workflow_run_not_active', `Run ${runId} has already ended.`, {
      runId,
      attemptId
    })
  }
  if (text.trim().length === 0) {
    throw invalid('A follow-up message cannot be empty.', { runId, attemptId })
  }
  const attempt = db.listWorkflowAttempts(runId).find((candidate) => candidate.id === attemptId)
  if (!attempt) {
    throw invalid(`Run ${runId} has no node attempt ${attemptId}.`, { runId, attemptId })
  }
  if (!MESSAGEABLE_ATTEMPT_STATES.has(attempt.state)) {
    throw invalid(`Node attempt ${attemptId} is not running (${attempt.state}).`, {
      runId,
      attemptId
    })
  }
  let message: RunMessageView | undefined
  atomically(db, () => {
    message = db.createWorkflowMessage({ runId, attemptId, sender, text, mode })
    new WorkflowRunRecorder(db, notifier, runId).event(
      'follow_up_queued',
      { messageId: message.id, mode, sender },
      { attemptId, reason: 'message' }
    )
  })
  if (!message) {
    throw new Error(`Follow-up for ${attemptId} was not recorded.`)
  }
  wakeWorkflowRun(runId)
  return message
}

/** The orchestration request id a queued follow-up is always sent under. */
export function followUpRequestId(message: Pick<RunMessageView, 'id'>): string {
  return `workflow-follow-up:${message.id}`
}

/** Mail already sent per follow-up, from its `follow_up_sent` markers. */
function sentMail(db: OrchestrationDb, runId: string): Map<string, string> {
  const sent = new Map<string, string>()
  for (const event of db.listWorkflowEventsOfKind(runId, SENT_EVENT)) {
    const messageId = readPath(event.payloadJson, ['messageId'])
    const mailId = readPath(event.payloadJson, ['orchestrationMessageId'])
    if (typeof messageId === 'string' && typeof mailId === 'string') {
      sent.set(messageId, mailId)
    }
  }
  return sent
}

/** The last recorded failure per follow-up, so a repeated one is not recorded on every retry. */
function lastFailures(db: OrchestrationDb, runId: string): Map<string, unknown> {
  const failures = new Map<string, unknown>()
  for (const event of db.listWorkflowEventsOfKind(runId, FAILED_EVENT)) {
    failures.set(
      String(readPath(event.payloadJson, ['messageId'])),
      readPath(event.payloadJson, ['error'])
    )
  }
  return failures
}

async function sendQueued(
  ctx: FollowUpDeliveryContext,
  dispatchId: string,
  message: RunMessageView
): Promise<FollowUpOutcome> {
  const receipt = await ctx.client.call(
    'orchestration.send',
    {
      to: `dispatch:${dispatchId}`,
      from: engineCoordinatorHandle(ctx.recorder.runId),
      type: 'status',
      subject: `Follow-up from ${message.sender}`,
      body: message.text
    },
    { requestId: followUpRequestId(message) }
  )
  const mailId = readPath(receipt, ['message', 'id'])
  if (typeof mailId !== 'string') {
    return { kind: 'retry', why: 'orchestration_send_without_message' }
  }
  ctx.recorder.event(
    SENT_EVENT,
    { messageId: message.id, orchestrationMessageId: mailId },
    { attemptId: message.attemptId, reason: 'message' }
  )
  return { kind: 'pending' }
}

function settleUndeliverable(
  db: OrchestrationDb,
  recorder: WorkflowRunRecorder,
  message: RunMessageView,
  reason: string
): void {
  if (db.failWorkflowMessage(message.id)?.state === 'failed') {
    recorder.event(
      'follow_up_undeliverable',
      { messageId: message.id, mode: message.mode, reason },
      { attemptId: message.attemptId, reason: 'message' }
    )
  }
}

function markDelivered(
  db: OrchestrationDb,
  recorder: WorkflowRunRecorder,
  message: RunMessageView
): void {
  if (db.deliverWorkflowMessage(message.id)?.state === 'delivered') {
    recorder.event(
      'follow_up_delivered',
      { messageId: message.id, mode: message.mode, sender: message.sender },
      { attemptId: message.attemptId, reason: 'message' }
    )
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function attemptDelivery(
  ctx: FollowUpDeliveryContext,
  dispatchId: string,
  message: RunMessageView
): Promise<FollowUpOutcome> {
  try {
    if (message.mode === 'queued') {
      return await sendQueued(ctx, dispatchId, message)
    }
    const worker = ctx.resolveWorker(dispatchId)
    return worker
      ? await sendInterrupt(ctx, worker, message)
      : { kind: 'retry', why: 'worker_not_found' }
  } catch (error) {
    return { kind: 'retry', why: errorMessage(error) }
  }
}

/** The agent received the mail at a checkpoint: a `check` claimed it, or it was acknowledged. */
function mailReceived(
  db: OrchestrationDb,
  dispatchId: string | undefined,
  mailId: string
): boolean {
  return (
    db.getMessageById(mailId)?.read === 1 ||
    (dispatchId !== undefined &&
      db.wasMessageClaimedByMailboxDelivery(`dispatch:${dispatchId}`, mailId))
  )
}

/**
 * The attempt or run ended, so nothing more can be sent: a final receipt check settles sent mail
 * as delivered or `not_received`; a message never sent fails with `unsentReason`.
 */
function settleAtEnd(
  db: OrchestrationDb,
  recorder: WorkflowRunRecorder,
  message: RunMessageView,
  attempt: NodeAttemptView | undefined,
  mailId: string | undefined,
  unsentReason: string
): void {
  if (mailId === undefined) {
    settleUndeliverable(db, recorder, message, unsentReason)
  } else if (mailReceived(db, attempt?.dispatchId, mailId)) {
    markDelivered(db, recorder, message)
  } else {
    settleUndeliverable(db, recorder, message, 'not_received')
  }
}

/** Works every due queued follow-up of the run; only the run's controller calls it. */
export async function deliverFollowUps(
  ctx: FollowUpDeliveryContext,
  now: number = Date.now()
): Promise<void> {
  const { db, recorder, backoff } = ctx
  const pending = db.listPendingWorkflowMessages(recorder.runId)
  backoff.retainOnly(new Set(pending.map((message) => message.id)))
  const attempts = new Map(db.listWorkflowAttempts(recorder.runId).map((a) => [a.id, a]))
  const sent = sentMail(db, recorder.runId)
  const failures = lastFailures(db, recorder.runId)
  for (const message of pending) {
    const attempt = attempts.get(message.attemptId)
    const mailId = sent.get(message.id)
    if (!attempt || ENDED_ATTEMPT_STATES.has(attempt.state)) {
      const unsent = `attempt_${attempt?.state ?? 'missing'}`
      settleAtEnd(db, recorder, message, attempt, mailId, unsent)
      continue
    }
    const { dispatchId } = attempt
    if (!dispatchId || !backoff.isDue(message.id, now)) {
      continue
    }
    if (mailId !== undefined) {
      // Sent already: never again. Delivered once a checkpoint received it; else poll again.
      if (mailReceived(db, dispatchId, mailId)) {
        backoff.clear(message.id)
        markDelivered(db, recorder, message)
      } else {
        backoff.recordFailure(message.id, now)
      }
      continue
    }
    const outcome = await attemptDelivery(ctx, dispatchId, message)
    if (outcome.kind === 'delivered') {
      backoff.clear(message.id)
      markDelivered(db, recorder, message)
    } else if (outcome.kind === 'rejected') {
      backoff.clear(message.id)
      settleUndeliverable(db, recorder, message, outcome.reason)
    } else {
      backoff.recordFailure(message.id, now)
      if (outcome.kind === 'retry' && failures.get(message.id) !== outcome.why) {
        recorder.event(
          FAILED_EVENT,
          { messageId: message.id, mode: message.mode, error: outcome.why },
          { attemptId: message.attemptId, reason: 'message' }
        )
      }
    }
  }
}

/** A finished run sends nothing more; each still-queued follow-up gets its final receipt check. */
export function failUndeliveredFollowUps(db: OrchestrationDb, recorder: WorkflowRunRecorder): void {
  const attempts = new Map(db.listWorkflowAttempts(recorder.runId).map((a) => [a.id, a]))
  const sent = sentMail(db, recorder.runId)
  for (const message of db.listPendingWorkflowMessages(recorder.runId)) {
    const attempt = attempts.get(message.attemptId)
    settleAtEnd(db, recorder, message, attempt, sent.get(message.id), 'run_ended')
  }
}
