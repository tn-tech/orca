import React, { useState } from 'react'
import { AlertCircle, AlertTriangle, ChevronDown, CircleCheck } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'
import { describeWorkflowProblem } from './workflow-problem-labels'

export type ValidationProblemsPanelProps = {
  problems: readonly WorkflowProblem[]
  /** Names nodes/edges/roles by title (N7); without it rows show raw ids. */
  definition?: Workflow
  /** Selects the offending node/edge (or a node that uses the offending role) on the canvas. */
  onFocusProblem: (problem: WorkflowProblem) => void
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
  definition,
  onFocusProblem
}: ValidationProblemsPanelProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
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
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="flex min-h-0 flex-col"
      data-testid="validation-problems-panel"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-accent"
        >
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              !expanded && '-rotate-90'
            )}
          />
          {translate(
            'auto.components.workflows.editor.ValidationProblemsPanel.summary',
            '{{errorCount}} error(s), {{warningCount}} warning(s)',
            { errorCount, warningCount }
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="scrollbar-sleek max-h-40 min-h-0 divide-y divide-border/50 overflow-y-auto border-t border-border">
          {sortBySeverity(problems).map((problem) => (
            <ProblemRow
              key={`${problem.code}-${problem.nodeId ?? ''}-${problem.edgeId ?? ''}-${problem.roleId ?? ''}-${problem.message}`}
              problem={problem}
              definition={definition}
              onFocusProblem={onFocusProblem}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ProblemRow({
  problem,
  definition,
  onFocusProblem
}: {
  problem: WorkflowProblem
  definition: Workflow | undefined
  onFocusProblem: (problem: WorkflowProblem) => void
}): React.JSX.Element {
  const { message, location } = describeWorkflowProblem(problem, definition)
  return (
    <li>
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
          <span className="block break-words text-foreground">{message}</span>
          {location ? (
            <span className="block text-[11px] text-muted-foreground">{location}</span>
          ) : null}
        </span>
      </button>
    </li>
  )
}
