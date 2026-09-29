import React from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'
import { describeWorkflowProblem } from './workflow-problem-labels'

/** F7: the selected node's or edge's own problems, inline above its fields. */
export default function InspectorProblemList({
  problems,
  definition
}: {
  problems: readonly WorkflowProblem[]
  definition: Workflow
}): React.JSX.Element | null {
  if (problems.length === 0) {
    return null
  }
  return (
    <ul className="space-y-1.5 text-xs" data-testid="node-inspector-problems">
      {problems.map((problem) => (
        <li
          key={`${problem.code}-${problem.message}`}
          className="flex items-start gap-1.5 text-foreground"
        >
          {problem.severity === 'error' ? (
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-annotation-highlight" />
          )}
          <span className="min-w-0 break-words">
            {describeWorkflowProblem(problem, definition).message}
          </span>
        </li>
      ))}
    </ul>
  )
}
