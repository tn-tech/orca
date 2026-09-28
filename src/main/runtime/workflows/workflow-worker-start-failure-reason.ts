import { AGENT_READINESS_TIMEOUT_REASON } from '../../../shared/workflows/workflow-attempt-failure-code'
import type { ParsedWorkerStartResult } from './workflow-worker-start-receipt'

// `timeout` is the bare waiter rejection (local start); the sentence is an unsatisfied wait (federated).
const READINESS_TIMEOUT_ERRORS = new Set(['timeout', 'Agent did not become ready (timeout).'])

/**
 * The attempt's failure reason for a worker start that did not reach `ready`.
 *
 * Why: a readiness timeout otherwise surfaces as the bare word "timeout", while the usual cause is
 * an agent parked on a startup prompt nobody sees — its terminal survives the failed start, so the
 * attempt panel's "Open transcript" shows it. The text is the fallback; the attempt view also
 * publishes its `agent_readiness_timeout` code for clients to map (workflow-attempt-failure-code.ts).
 */
export function describeWorkerStartFailure(
  parsed: Pick<ParsedWorkerStartResult, 'failedStage' | 'lastError'>
): string | undefined {
  if (
    parsed.failedStage === 'agent_readiness' &&
    parsed.lastError !== undefined &&
    READINESS_TIMEOUT_ERRORS.has(parsed.lastError)
  ) {
    return AGENT_READINESS_TIMEOUT_REASON
  }
  return parsed.lastError
}
