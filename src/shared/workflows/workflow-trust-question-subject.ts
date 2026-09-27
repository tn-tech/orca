// Decodes a `trust` question's `optionsJson` (FR-018a, data-model.md §workflow_run_questions):
// `{ choices, trust: { source, host, skills, agents } }`. Shared because the engine raises the
// question (workflow-source-trust.ts) and the renderer reads it back (run-view/QuestionCard.tsx)
// from the same wire shape.
import type { JsonValue } from './workflow-condition-schema'
import type { RunQuestionView } from './workflow-run-types'

export type TrustQuestionSubject = {
  source: string
  host: string
  skills: string[]
  agents: string[]
}

/** Coerces a `JsonValue` into a string array: not-an-array becomes empty, non-string entries are
 *  dropped. Exported because `run-view/use-workflow-run-snapshot.ts` needs the same coercion for
 *  a `skills_provisioned` event's payload — same shape, unrelated question. */
export function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/** The source/host/skills/agents a `trust` question asks about; `undefined` for any other
 *  question kind or a payload that doesn't match the documented shape. */
export function trustQuestionSubject(question: RunQuestionView): TrustQuestionSubject | undefined {
  if (question.kind !== 'trust') {
    return undefined
  }
  const options = question.optionsJson
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return undefined
  }
  const subject = options.trust
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) {
    return undefined
  }
  const { source, host, skills, agents } = subject
  if (typeof source !== 'string' || typeof host !== 'string') {
    return undefined
  }
  return { source, host, skills: stringArray(skills), agents: stringArray(agents) }
}
