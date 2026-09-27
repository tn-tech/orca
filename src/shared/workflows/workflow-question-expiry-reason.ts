import type { RunEventView } from './workflow-run-types'

const EXPIRY_EVENT_KINDS = new Set(['approval_expired', 'agent_question_expired'])

/** Why a settled question with no answer closed, from its `approval_expired` or
 *  `agent_question_expired` event (`workflow-question-deadlines.ts` `expireQuestion`): e.g.
 *  `run_ended`, `attempt_cancelled`, `superseded`. `undefined` for a genuine deadline timeout
 *  (the event carries no `reason`) or when no expiry event matches. */
export function questionExpiryReason(
  events: readonly RunEventView[],
  questionId: string
): string | undefined {
  const event = events.find((candidate) => {
    if (!EXPIRY_EVENT_KINDS.has(candidate.kind)) {
      return false
    }
    const payload = candidate.payloadJson
    return (
      !!payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      payload.questionId === questionId
    )
  })
  const payload = event?.payloadJson
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }
  const reason = payload.reason
  return typeof reason === 'string' ? reason : undefined
}
