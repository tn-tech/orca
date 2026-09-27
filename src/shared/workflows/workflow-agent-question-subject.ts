// Decodes an `agent-question`'s `optionsJson` (data-model.md §workflow_run_questions). Shared
// because the engine raises the question and every client reads it back
// (run-view/QuestionCard.tsx) from the same wire shape.
import type { RunQuestionView } from './workflow-run-types'

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
