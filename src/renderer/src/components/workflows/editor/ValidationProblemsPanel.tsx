import React from 'react'
import { AlertCircle, AlertTriangle, CircleCheck } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { WorkflowProblem } from '../../../../../shared/workflows/workflow-definition-types'

export type ValidationProblemsPanelProps = {
  problems: readonly WorkflowProblem[]
  /** Selects the offending node/edge (or a node that uses the offending role) on the canvas. */
  onFocusProblem: (problem: WorkflowProblem) => void
}

function problemLocationLabel(problem: WorkflowProblem): string | undefined {
  if (problem.nodeId) {
    return translate(
      'auto.components.workflows.editor.ValidationProblemsPanel.locationNode',
      'Node "{{id}}"',
      { id: problem.nodeId }
    )
  }
  if (problem.edgeId) {
    return translate(
      'auto.components.workflows.editor.ValidationProblemsPanel.locationEdge',
      'Edge "{{id}}"',
      { id: problem.edgeId }
    )
  }
  if (problem.roleId) {
    return translate(
      'auto.components.workflows.editor.ValidationProblemsPanel.locationRole',
      'Role "{{id}}"',
      { id: problem.roleId }
    )
  }
  return undefined
}

/** Errors first, in list order otherwise — a stable sort keeps rows from jumping on re-render. */
function sortBySeverity(problems: readonly WorkflowProblem[]): WorkflowProblem[] {
  return [...problems].sort((a, b) => {
    if (a.severity === b.severity) {
      return 0
    }
    return a.severity === 'error' ? -1 : 1
  })
}

/** FR-009: every problem from local `validateWorkflowGraph` plus the host `workflow.validate`
 *  result (merged and deduped by the caller), click-to-focus the offending node/edge/role. */
export default function ValidationProblemsPanel({
  problems,
  onFocusProblem
}: ValidationProblemsPanelProps): React.JSX.Element {
  if (problems.length === 0) {
    return (
      <div
        className="flex items-center gap-2 p-3 text-xs text-muted-foreground"
        data-testid="validation-problems-empty"
      >
        <CircleCheck className="size-3.5 shrink-0" />
        {translate(
          'auto.components.workflows.editor.ValidationProblemsPanel.empty',
          'No problems found.'
        )}
      </div>
    )
  }

  const errorCount = problems.filter((problem) => problem.severity === 'error').length
  const warningCount = problems.length - errorCount

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="validation-problems-panel">
      <div className="shrink-0 border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
        {translate(
          'auto.components.workflows.editor.ValidationProblemsPanel.summary',
          '{{errorCount}} error(s), {{warningCount}} warning(s)',
          { errorCount, warningCount }
        )}
      </div>
      <ul className="scrollbar-sleek min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto">
        {sortBySeverity(problems).map((problem) => (
          <li
            key={`${problem.code}-${problem.nodeId ?? ''}-${problem.edgeId ?? ''}-${problem.roleId ?? ''}-${problem.message}`}
          >
            <button
              type="button"
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
              onClick={() => onFocusProblem(problem)}
              data-testid="validation-problem-row"
              data-severity={problem.severity}
            >
              {problem.severity === 'error' ? (
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              ) : (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-annotation-highlight" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{problem.message}</span>
                {problemLocationLabel(problem) ? (
                  <span className="block text-[11px] text-muted-foreground">
                    {problemLocationLabel(problem)}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
