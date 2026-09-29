import React from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { WorkflowNodeProblemSummary } from '../workflow-node-problem-summary'

/** F7: flags a node that has validation problems right on its card; the Problems panel and the
 *  inspector carry the full text, the tooltip just lists it where the user is already looking. */
export default function WorkflowNodeProblemIndicator({
  problem
}: {
  problem: WorkflowNodeProblemSummary | undefined
}): React.JSX.Element | null {
  if (!problem) {
    return null
  }
  const count = problem.messages.length
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={translate(
            'auto.components.workflows.editor.WorkflowNodeProblemIndicator.label',
            'Problems: {{count}}',
            { count }
          )}
          data-testid="workflow-node-problem-indicator"
          data-severity={problem.severity}
          className={cn(
            'flex shrink-0 items-center gap-0.5 text-xs',
            problem.severity === 'error' ? 'text-destructive' : 'text-annotation-highlight'
          )}
        >
          {problem.severity === 'error' ? (
            <AlertCircle className="size-3.5" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-3.5" aria-hidden="true" />
          )}
          {count}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <ul className="space-y-0.5">
          {problem.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}
