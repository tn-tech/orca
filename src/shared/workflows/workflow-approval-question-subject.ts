// Encodes and decodes an `approval` question's `optionsJson` (FR-033, data-model.md
// §workflow_run_questions): `{ choices, approval: { options, defaultOption? } }`. Shared because the
// engine raises the question (workflow-approval-gates.ts) and every client reads it back.
import type { JsonValue } from './workflow-condition-schema'
import type { RunQuestionView } from './workflow-run-types'
import { stringArray } from './workflow-trust-question-subject'

export type ApprovalQuestionSubject = {
  /** The Approval node's options; each is also the id of the outgoing port it routes on. */
  options: string[]
  /** Applied when the escalation grace elapses unanswered; absent means the node fails. */
  defaultOption?: string
}

/** `answeredBy` for an answer the engine applied from `defaultOption` on timeout, not a person
 *  (`workflow-approval-deadlines.ts`'s `APPROVAL_DEFAULT_ANSWERER` — same value, shared here so
 *  clients can recognize it without importing main-process code; that module switches to this
 *  constant in a later unit). */
export const APPROVAL_DEFAULT_ANSWERER = 'workflow-engine:default-option'

export function approvalQuestionOptions(subject: ApprovalQuestionSubject): JsonValue {
  return {
    choices: subject.options.map((option) => ({ id: option, label: option })),
    approval: {
      options: subject.options,
      ...(subject.defaultOption === undefined ? {} : { defaultOption: subject.defaultOption })
    }
  }
}

/** `undefined` for any other question kind or a payload that doesn't match the documented shape. */
export function approvalQuestionSubject(
  question: RunQuestionView
): ApprovalQuestionSubject | undefined {
  if (question.kind !== 'approval') {
    return undefined
  }
  const payload = question.optionsJson
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }
  const approval = payload.approval
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    return undefined
  }
  const options = stringArray(approval.options)
  if (options.length === 0) {
    return undefined
  }
  const { defaultOption } = approval
  return typeof defaultOption === 'string' && options.includes(defaultOption)
    ? { options, defaultOption }
    : { options }
}
