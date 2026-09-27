// "Interrupt now" follow-ups (FR-036a): direct input into the worker's own session. A terminal
// worker gets the runtime's agent-prompt write (sanitised bracketed paste, then a settled Enter),
// the same path a worker's brief takes; `terminal.send` would type raw text and a bare `\r`, and
// only admits that path for desktop clients. A structured worker gets an `agentSession.send`
// user turn under a per-message operation id, so a retried send lands once.
import { createHash } from 'node:crypto'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type { RunMessageView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { createStructuredMailboxPointerHost } from '../orchestration/structured-mailbox-pointer-host'
import { resolveStructuredWorkerForDispatch } from '../rpc/methods/orchestration-structured-worker-lifecycle'
import type { WorkflowWorkerInputClient } from './workflow-orchestration-client'

/** The session behind a dispatch; a structured one needs its current fence to be written to. */
export type FollowUpWorker =
  | { kind: 'terminal'; handle: string }
  | { kind: 'structured'; sessionId: string; runtimeFence: number | null }

export type FollowUpInterruptPorts = {
  workerInput: WorkflowWorkerInputClient
  sendTerminalPrompt(handle: string, prompt: string): Promise<{ accepted: boolean }>
}

export type FollowUpOutcome =
  | { kind: 'delivered' }
  | { kind: 'retry'; why: string }
  | { kind: 'rejected' }

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

export function readPath(value: unknown, keys: readonly string[]): unknown {
  let current = value
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }
    current = Reflect.get(current, key)
  }
  return current
}

async function sendStructuredTurn(
  ports: FollowUpInterruptPorts,
  worker: Extract<FollowUpWorker, { kind: 'structured' }>,
  message: RunMessageView
): Promise<FollowUpOutcome> {
  if (worker.runtimeFence === null) {
    return { kind: 'retry', why: 'agent_session_not_attached' }
  }
  const body = userTurn(message.text)
  const result = await ports.workerInput.call('agentSession.send', {
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

export async function sendInterrupt(
  ports: FollowUpInterruptPorts,
  worker: FollowUpWorker,
  message: RunMessageView
): Promise<FollowUpOutcome> {
  if (worker.kind === 'structured') {
    return sendStructuredTurn(ports, worker, message)
  }
  const { accepted } = await ports.sendTerminalPrompt(worker.handle, message.text)
  return accepted ? { kind: 'delivered' } : { kind: 'retry', why: 'terminal_input_not_accepted' }
}
