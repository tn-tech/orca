// Recovers the planner's drafted definition from its settled attempt. A result that failed the
// definition schema is still recovered from the recorded raw body, so the caller gets the
// parser's precise problems instead of a bare `result_invalid`.
import type { NodeAttemptView, RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'

// Why: a definition is a few KB; anything this large is runaway output, not a workflow to edit.
export const MAX_DRAFT_RESULT_CHARS = 256 * 1024

export type PlannerRawDraft =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string }

const TOO_LARGE: PlannerRawDraft = {
  ok: false,
  code: 'workflow_draft_too_large',
  message: `The planner's draft is larger than ${MAX_DRAFT_RESULT_CHARS / 1024} KB.`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** handleWorkerDone records the unparsed result.json on the attempt's `attempt_failed` event. */
function recordedRawBody(
  db: OrchestrationDb,
  runId: string,
  attemptId: string
): string | undefined {
  const failed = db
    .listWorkflowEventsOfKind(runId, 'attempt_failed')
    .findLast((event) => event.attemptId === attemptId)
  const payload = failed?.payloadJson
  return isPlainObject(payload) && typeof payload.rawBody === 'string' ? payload.rawBody : undefined
}

function fromRawBody(rawBody: string): PlannerRawDraft {
  if (rawBody.length > MAX_DRAFT_RESULT_CHARS) {
    return TOO_LARGE
  }
  try {
    return { ok: true, value: JSON.parse(rawBody) }
  } catch {
    return {
      ok: false,
      code: 'workflow_draft_invalid_json',
      message: "The planner's result is not valid JSON."
    }
  }
}

export function plannerRawDraft(
  db: OrchestrationDb,
  run: RunSnapshot,
  attempt: NodeAttemptView | undefined
): PlannerRawDraft {
  if (attempt?.state === 'completed' && attempt.resultJson !== undefined) {
    return JSON.stringify(attempt.resultJson).length > MAX_DRAFT_RESULT_CHARS
      ? TOO_LARGE
      : { ok: true, value: attempt.resultJson }
  }
  if (attempt?.failureReason === 'result_invalid') {
    const rawBody = recordedRawBody(db, run.id, attempt.id)
    if (rawBody !== undefined) {
      return fromRawBody(rawBody)
    }
  }
  const reason = attempt?.failureReason ?? attempt?.state ?? `run ${run.state}`
  return {
    ok: false,
    code: 'workflow_draft_failed',
    message: `The planner did not produce a draft (${reason}).`
  }
}
