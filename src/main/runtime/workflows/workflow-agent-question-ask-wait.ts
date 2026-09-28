// An agent question's deadlines must fall while the agent still blocks in `orchestration ask`:
// after its own wait ends the agent works on, and only `ask --resume` would reach the answer. The
// host already records each ask's clamped wait in the ask's mutation receipt; an ask without one
// (no request id, or a federated ask whose receipt lives on the worker's host) is assumed to wait
// the default.
import {
  clampOrchestrationAskTimeoutMs,
  ORCHESTRATION_ASK_DEFAULT_TIMEOUT_MS
} from '../../../shared/orchestration-ask-timeout'
import type { Node } from '../../../shared/workflows/workflow-definition-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { MessageRow } from '../orchestration/types'
import { questionDeadlines } from './workflow-question-deadlines'

/** Why: the engine must stop the agent while it still blocks in ask, not race its timeout. */
export const AGENT_QUESTION_ASK_WAIT_MARGIN_MS = 5_000

// Why: router and reflection nodes have no `question` config, yet their agents can still ask.
const DEFAULT_QUESTION_TIMING = {
  timeoutMs: ORCHESTRATION_ASK_DEFAULT_TIMEOUT_MS,
  escalationGraceMs: ORCHESTRATION_ASK_DEFAULT_TIMEOUT_MS
}

export type AgentAskWait = { startedAt: number; timeoutMs: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseUtc(timestamp: string): number | undefined {
  // Stored as `YYYY-MM-DD HH:MM:SS` UTC; exposed rows carry an explicit offset.
  const at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(timestamp) ? timestamp : `${timestamp}Z`)
  return Number.isNaN(at) ? undefined : at
}

/** The original ask's wait, read from its receipt; the message time stands in for its start. */
export function readAgentAskWait(db: OrchestrationDb, message: MessageRow): AgentAskWait {
  const row: unknown = db.db
    .prepare(
      `SELECT json_extract(receipt, '$.timeoutMs') AS timeout_ms FROM mutation_receipts
       WHERE method = 'orchestration.ask' AND json_extract(receipt, '$.messageId') = ?
       ORDER BY created_at ASC, rowid ASC LIMIT 1`
    )
    .get(message.id)
  const recorded: unknown = isRecord(row) ? row.timeout_ms : undefined
  return {
    startedAt: parseUtc(message.created_at.replace(' ', 'T')) ?? Date.now(),
    timeoutMs: clampOrchestrationAskTimeoutMs(typeof recorded === 'number' ? recorded : undefined)
  }
}

/**
 * The node's timing (`question.timeoutMs` + `escalationGraceMs`), scaled down proportionally when
 * it would outlast the ask wait, so escalation still precedes the final timeout.
 */
export function agentQuestionDeadlines(
  raisedAt: number,
  node: Node | undefined,
  askWait: AgentAskWait = { startedAt: raisedAt, timeoutMs: ORCHESTRATION_ASK_DEFAULT_TIMEOUT_MS }
): { escalationAt: number; timeoutAt: number } {
  const timing = node?.type === 'agent' ? node.question : DEFAULT_QUESTION_TIMING
  const waitEndsAt = askWait.startedAt + askWait.timeoutMs - AGENT_QUESTION_ASK_WAIT_MARGIN_MS
  const window = Math.max(0, waitEndsAt - raisedAt)
  const total = timing.timeoutMs + timing.escalationGraceMs
  if (total <= window) {
    return questionDeadlines(raisedAt, timing)
  }
  return {
    escalationAt: raisedAt + Math.floor((window * timing.timeoutMs) / total),
    timeoutAt: raisedAt + window
  }
}
