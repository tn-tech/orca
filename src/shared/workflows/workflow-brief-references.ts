// `${...}` reference syntax resolved into brief.md prompt text (contracts/agent-brief.md).
import type { JsonValue } from './workflow-condition-schema'
import type { WorkflowProblem } from './workflow-problem'
import { getResultPath } from './workflow-result-path'

export type BriefReferenceInputs = {
  objective: string
  upstream: Record<string, { result: JsonValue; artifacts: string[] }>
  loopPrevious?: Record<string, { result: JsonValue }>
  joinBranches?: JsonValue
}

/** Resolves one `${...}` reference body; undefined means unresolved (unknown form or no data). */
function resolveReference(reference: string, inputs: BriefReferenceInputs): unknown {
  if (reference === 'objective') {
    return inputs.objective
  }
  if (reference === 'join.branches') {
    return inputs.joinBranches
  }

  const segments = reference.split('.')
  if (segments[0] === 'upstream' && segments.length >= 3) {
    const upstream = inputs.upstream[segments[1]]
    if (!upstream) {
      return undefined
    }
    if (segments[2] === 'result') {
      return getResultPath(upstream.result, segments.slice(3).join('.'))
    }
    if (segments[2] === 'artifacts' && segments.length === 3) {
      return upstream.artifacts
    }
    return undefined
  }
  if (segments[0] === 'loop' && segments[1] === 'previous' && segments[3] === 'result') {
    const previous = inputs.loopPrevious?.[segments[2]]
    if (!previous) {
      return undefined
    }
    return getResultPath(previous.result, segments.slice(4).join('.'))
  }
  return undefined
}

function stringifyResolved(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Resolves every `${...}` reference in `text`; unresolved ones are left as-is and reported. */
export function resolveBriefReferences(
  text: string,
  inputs: BriefReferenceInputs
): { text: string; problems: WorkflowProblem[] } {
  const problems: WorkflowProblem[] = []
  const resolvedText = text.replace(/\$\{([^}]+)\}/g, (match, reference: string) => {
    const value = resolveReference(reference, inputs)
    if (value === undefined) {
      problems.push({
        code: 'workflow_brief_reference_unresolved',
        message: `Unresolved brief reference: \${${reference}}`,
        severity: 'error'
      })
      return match
    }
    return stringifyResolved(value)
  })
  return { text: resolvedText, problems }
}
