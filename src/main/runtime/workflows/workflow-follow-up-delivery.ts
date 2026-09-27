// Follow-up messages to a running node's agent (FR-036/FR-036a, spec US5 AS6a, research R8). A
// person's message is recorded `queued` on the attempt (queueFollowUp) and wakes the run; the
// controller then delivers it on its next pass. Queued mode goes through `orchestration.send` to
// `dispatch:<id>`, whose mailbox nudge prompts the agent at its next checkpoint; "interrupt now"
// is direct input into the worker's session: `terminal.send` for a terminal worker,
// `agentSession.send` for a structured one. A message is `delivered` only once the host confirmed
// it; anything it could not confirm (an unreachable SSH host, an unsettled send) stays queued and
// is retried with backoff. A message whose attempt ended first can never arrive: it fails.
import { createHash } from 'node:crypto'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type {
  NodeAttemptView,
  RunMessageView,
  WorkflowMessageMode
} from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { createStructuredMailboxPointerHost } from '../orchestration/structured-mailbox-pointer-host'
import { resolveStructuredWorkerForDispatch } from '../rpc/methods/orchestration-structured-worker-lifecycle'
import type { AgentAnswerDeliveryBackoff } from './workflow-agent-answer-delivery'
import { engineCoordinatorHandle } from './workflow-engine-principal'
import type {
  WorkflowOrchestrationClient,
  WorkflowWorkerInputClient
} from './workflow-orchestration-client'
import { WorkflowRunRecorder, type WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { wakeWorkflowRun } from './workflow-run-wake'

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled'])
const ENDED_ATTEMPT_STATES = new Set<NodeAttemptView['state']>([
  'completed',
  'failed',
  'skipped',
  'cancelled'
])

/** The session behind a dispatch; a structured one needs its current fence to be written to. */
export type FollowUpWorker =
  | { kind: 'terminal'; handle: string }
  | { kind: 'structured'; sessionId: string; runtimeFence: number | null }

export type FollowUpDeliveryContext = {
  db: OrchestrationDb
  recorder: WorkflowRunRecorder
  client: WorkflowOrchestrationClient
  workerInput: WorkflowWorkerInputClient
  resolveWorker(dispatchId: string): FollowUpWorker | undefined
  backoff: AgentAnswerDeliveryBackoff
}

type DeliveryOutcome = { kind: 'delivered' } | { kind: 'retry'; why: string } | { kind: 'rejected' }

function invalid(message: string, data: Record<string, string>): OrchestrationError {
  return new OrchestrationError('invalid_argument', message, data)
}

/** Records a person's follow-up on a live node attempt and wakes the run to deliver it. */
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
  if (ENDED_ATTEMPT_STATES.has(attempt.state)) {
    throw invalid(`Node attempt ${attemptId} is no longer running (${attempt.state}).`, {
      runId,
      attemptId
    })
  }
  const message = db.createWorkflowMessage({ runId, attemptId, sender, text, mode })
  new WorkflowRunRecorder(db, notifier, runId).event(
    'follow_up_queued',
    { messageId: message.id, mode, sender },
    { attemptId, reason: 'message' }
  )
  wakeWorkflowRun(runId)
  return message
}

/** Terminal or structured, from the handle the dispatch was started with (as workerStop does). */
export function resolveFollowUpWorker(
  db: OrchestrationDb,
  dispatchId: string
): FollowUpWorker | undefined {
  const structured = resolveStructuredWorkerForDispatch(db, dispatchId)
  if (structured) {
    return {
      kind: 'structured',
      sessionId: structured.sessionId,
      runtimeFence: createStructuredMailboxPointerHost().currentFence(structured.sessionId)
    }
  }
  const handle =
    db.getWorkerDispatch(dispatchId)?.agent_terminal_handle ??
    db.getDispatchContextById(dispatchId)?.assignee_handle
  return handle ? { kind: 'terminal', handle } : undefined
}

function userTurn(text: string): AgentJournalMessageItem {
  return { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] }
}

/** Stable per message: the operation id is the host's idempotency key, so a retry lands once. */
function followUpOperationId(message: RunMessageView): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(['workflow-follow-up', message.id]))
    .digest('hex')
  return `${String(Date.parse(message.createdAt)).padStart(13, '0')}-${digest.slice(0, 32)}`
}

function readPath(value: unknown, keys: readonly string[]): unknown {
  let current = value
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }
    current = Reflect.get(current, key)
  }
  return current
}

async function interrupt(
  ctx: FollowUpDeliveryContext,
  worker: FollowUpWorker,
  message: RunMessageView
): Promise<DeliveryOutcome> {
  if (worker.kind === 'terminal') {
    const result = await ctx.workerInput.call('terminal.send', {
      terminal: worker.handle,
      text: message.text,
      enter: true
    })
    return readPath(result, ['send', 'accepted']) === true
      ? { kind: 'delivered' }
      : { kind: 'retry', why: 'terminal_input_not_accepted' }
  }
  if (worker.runtimeFence === null) {
    return { kind: 'retry', why: 'agent_session_not_attached' }
  }
  const body = userTurn(message.text)
  const result = await ctx.workerInput.call('agentSession.send', {
    envelope: {
      sessionId: worker.sessionId,
      clientOperationId: followUpOperationId(message),
      expectedRuntimeFence: worker.runtimeFence,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: worker.sessionId,
        fields: { body }
      })
    },
    body
  })
  if (readPath(result, ['ok']) !== true) {
    const code = readPath(result, ['refusal', 'code'])
    return { kind: 'retry', why: typeof code === 'string' ? code : 'agent_session_send_refused' }
  }
  // `pending` is not yet an acknowledgement; only `accepted` confirms the turn reached the agent.
  const state = readPath(result, ['value', 'submission', 'dispatchState'])
  if (state === 'accepted') {
    return { kind: 'delivered' }
  }
  return state === 'rejected'
    ? { kind: 'rejected' }
    : { kind: 'retry', why: `agent_session_send_${String(state)}` }
}

async function deliver(
  ctx: FollowUpDeliveryContext,
  attempt: NodeAttemptView & { dispatchId: string },
  message: RunMessageView
): Promise<DeliveryOutcome> {
  if (message.mode === 'queued') {
    await ctx.client.call('orchestration.send', {
      to: `dispatch:${attempt.dispatchId}`,
      from: engineCoordinatorHandle(ctx.recorder.runId),
      type: 'status',
      subject: `Follow-up from ${message.sender}`,
      body: message.text
    })
    return { kind: 'delivered' }
  }
  const worker = ctx.resolveWorker(attempt.dispatchId)
  return worker ? interrupt(ctx, worker, message) : { kind: 'retry', why: 'worker_not_found' }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Delivers every due queued follow-up of the run; only the run's controller calls it. */
export async function deliverFollowUps(
  ctx: FollowUpDeliveryContext,
  now: number = Date.now()
): Promise<void> {
  const { db, recorder, backoff } = ctx
  const pending = db.listPendingWorkflowMessages(recorder.runId)
  backoff.retainOnly(new Set(pending.map((message) => message.id)))
  const attempts = new Map(db.listWorkflowAttempts(recorder.runId).map((a) => [a.id, a]))
  for (const message of pending) {
    const attempt = attempts.get(message.attemptId)
    if (!attempt || ENDED_ATTEMPT_STATES.has(attempt.state)) {
      settleUndeliverable(db, recorder, message, `attempt_${attempt?.state ?? 'missing'}`)
      continue
    }
    const { dispatchId } = attempt
    if (!dispatchId || !backoff.isDue(message.id, now)) {
      continue
    }
    const options = { attemptId: attempt.id, reason: 'message' as const }
    let outcome: DeliveryOutcome
    try {
      outcome = await deliver(ctx, { ...attempt, dispatchId }, message)
    } catch (error) {
      outcome = { kind: 'retry', why: errorMessage(error) }
    }
    if (outcome.kind === 'retry') {
      backoff.recordFailure(message.id, now)
      recorder.event(
        'follow_up_delivery_failed',
        { messageId: message.id, mode: message.mode, error: outcome.why },
        options
      )
      continue
    }
    backoff.clear(message.id)
    if (outcome.kind === 'rejected') {
      settleUndeliverable(db, recorder, message, 'agent_session_send_rejected')
      continue
    }
    if (db.deliverWorkflowMessage(message.id)?.state === 'delivered') {
      recorder.event(
        'follow_up_delivered',
        { messageId: message.id, mode: message.mode, sender: message.sender },
        options
      )
    }
  }
}

/** A finished run delivers nothing more; its still-queued follow-ups can never arrive. */
export function failUndeliveredFollowUps(db: OrchestrationDb, recorder: WorkflowRunRecorder): void {
  for (const message of db.listPendingWorkflowMessages(recorder.runId)) {
    settleUndeliverable(db, recorder, message, 'run_ended')
  }
}
