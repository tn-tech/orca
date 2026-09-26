import type { WorkflowProblem } from '../../../../../shared/workflows/workflow-definition-types'

/** Only the host's `workflow.validate` result can verify this — it needs the project's
 *  skill-source allowlist, which the renderer's local validation context never has
 *  (see `workflow-graph-validation-context.ts`). Dropped from the local list so a workflow
 *  that is actually allowlisted doesn't sit blocked on a false positive between edits. */
const HOST_ONLY_PROBLEM_CODES: ReadonlySet<string> = new Set(['graph_skill_source_not_allowlisted'])

function problemKey(problem: WorkflowProblem): string {
  return [
    problem.code,
    problem.nodeId ?? '',
    problem.edgeId ?? '',
    problem.roleId ?? '',
    problem.message
  ].join('\u0000')
}

/** Merges instant local-graph feedback with the host's authoritative `workflow.validate` result
 *  (FR-009), deduping identical rows so an edit that's been round-tripped isn't listed twice. */
export function mergeWorkflowValidationProblems(
  localProblems: readonly WorkflowProblem[],
  hostProblems: readonly WorkflowProblem[]
): WorkflowProblem[] {
  const merged = [...hostProblems]
  const seen = new Set(hostProblems.map(problemKey))
  for (const problem of localProblems) {
    if (HOST_ONLY_PROBLEM_CODES.has(problem.code)) {
      continue
    }
    const key = problemKey(problem)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(problem)
  }
  return merged
}

/** FR-009: Run stays disabled while any severity-'error' problem remains; warnings don't block. */
export function hasBlockingWorkflowProblems(problems: readonly WorkflowProblem[]): boolean {
  return problems.some((problem) => problem.severity === 'error')
}
