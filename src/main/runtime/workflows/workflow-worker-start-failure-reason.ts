import type { ParsedWorkerStartResult } from './workflow-worker-start-receipt'

// `timeout` is the bare waiter rejection (local start); the sentence is an unsatisfied wait (federated).
const READINESS_TIMEOUT_ERRORS = new Set(['timeout', 'Agent did not become ready (timeout).'])

/**
 * The attempt's failure reason for a worker start that did not reach `ready`.
 *
 * Why: a readiness timeout otherwise surfaces as the bare word "timeout", while the usual cause is
 * an agent parked on a startup prompt nobody sees — its terminal survives the failed start, so the
 * attempt panel's "Open transcript" shows it. Plain text so every client version renders it.
 */
export function describeWorkerStartFailure(
  parsed: Pick<ParsedWorkerStartResult, 'failedStage' | 'lastError'>
): string | undefined {
  if (
    parsed.failedStage === 'agent_readiness' &&
    parsed.lastError !== undefined &&
    READINESS_TIMEOUT_ERRORS.has(parsed.lastError)
  ) {
    return (
      'The agent never became ready. It may be waiting on a prompt in its terminal, such as a ' +
      'question about trusting the folder. Open the transcript to see it. (timeout)'
    )
  }
  return parsed.lastError
}
