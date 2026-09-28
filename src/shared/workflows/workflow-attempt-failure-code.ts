// Stable, machine-readable codes published next to an attempt's free-text `failureReason`, so a
// client can render its own copy while older clients still show the engine text.

/** The agent's terminal never reached readiness — usually a startup prompt nobody answered. */
export const AGENT_READINESS_TIMEOUT_FAILURE_CODE = 'agent_readiness_timeout'

/** Engine fallback text for `agent_readiness_timeout`; clients without a label render it as-is. */
export const AGENT_READINESS_TIMEOUT_REASON =
  'The agent never became ready. It may be waiting on a prompt in its terminal, such as a ' +
  'question about trusting the folder. Open the transcript to see it. (timeout)'

/**
 * The code for a stored `failureReason`, or undefined when it has none.
 * Why derived, not stored: it adds no orchestration.db column (and no schema bump) while the
 * engine writes exactly one text per code — the constant above is the single source for both.
 */
export function workflowAttemptFailureCode(failureReason: string | undefined): string | undefined {
  return failureReason === AGENT_READINESS_TIMEOUT_REASON
    ? AGENT_READINESS_TIMEOUT_FAILURE_CODE
    : undefined
}
