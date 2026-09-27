// Decodes an `approval`/`agent-question`'s `optionsJson` (data-model.md §workflow_run_questions).
// Shared because the engine raises these questions and the renderer reads them back
// (run-view/QuestionCard.tsx) from the same wire shape; U45 (engine) lands concurrently, so an
// unrecognized shape decodes to `undefined` rather than throwing.
import type { JsonValue } from './workflow-condition-schema'
import type { RunQuestionView } from './workflow-run-types'

export type QuestionChoice = { id: string; label: string }

function isQuestionChoice(value: JsonValue): value is QuestionChoice {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string'
  )
}

/** An `approval` question's options — one per `ApprovalNode.options` entry (data-model.md §1
 *  ApprovalNode, FR-033), `id` equal to the option text so it can be sent back as `optionId`
 *  (`workflow.run.answer`). `undefined` for any other question kind or an unrecognized payload. */
export function approvalQuestionChoices(question: RunQuestionView): QuestionChoice[] | undefined {
  if (question.kind !== 'approval') {
    return undefined
  }
  const options = question.optionsJson
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return undefined
  }
  const choices = options.choices
  if (!Array.isArray(choices)) {
    return undefined
  }
  const decoded = choices.filter(isQuestionChoice)
  return decoded.length > 0 ? decoded : undefined
}

/** The agent's context for an `agent-question` (FR-033a: "publish the question with the agent's
 *  context"), when the engine included one. `undefined` for any other kind or a missing context. */
export function agentQuestionContext(question: RunQuestionView): string | undefined {
  if (question.kind !== 'agent-question') {
    return undefined
  }
  const options = question.optionsJson
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return undefined
  }
  const context = options.context
  return typeof context === 'string' ? context : undefined
}
