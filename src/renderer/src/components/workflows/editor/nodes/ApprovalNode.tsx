import React, { useRef } from 'react'
import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react'
import { UserCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { ApprovalNode as ApprovalNodeDefinition } from '../../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../../shared/workflows/workflow-node-states'
import { WORKFLOW_NODE_WIDTH } from '../workflow-auto-layout'
import { routableChoiceIndices } from '../workflow-router-choices'
import { workflowNodeStatusDotClassName } from './workflow-node-run-status-style'

export type WorkflowApprovalNodeData = {
  definitionNode: ApprovalNodeDefinition
  attemptState?: WorkflowAttemptState
}

export type WorkflowApprovalFlowNode = FlowNode<WorkflowApprovalNodeData, 'approval'>

function timeoutLabel(timeoutMs: number): string {
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000))
  return translate(
    'auto.components.workflows.editor.ApprovalNode.timeout',
    'Timeout: {{minutes}}m',
    {
      minutes
    }
  )
}

/** Pauses the run for a human decision (data-model.md §1 ApprovalNode, FR-033): one source Handle
 *  per option, `id` equal to the option text so it matches `Edge.fromPort` — the same convention
 *  `RouterNode.tsx` uses for its choices. */
export default function ApprovalNode({
  data,
  selected
}: NodeProps<WorkflowApprovalFlowNode>): React.JSX.Element {
  const { definitionNode, attemptState } = data
  const statusDotClassName = workflowNodeStatusDotClassName(attemptState)
  // Two unedited "Add option" rows share the text `''`, and a user can retype one to match
  // another — only the first occurrence of each text gets a Handle (same reasoning as
  // `RouterNode.tsx`): a duplicate `id` would leave React Flow to guess which Handle an edge
  // actually connects to.
  const routableIndices = routableChoiceIndices(definitionNode.options)
  // Why: option text alone can't key these rows (it can repeat or be blank) and there's no other
  // per-option id — a per-slot uuid keeps `key` off the bare array index despite this row having
  // no local state to protect.
  const rowKeysRef = useRef<string[]>(undefined!)
  rowKeysRef.current ??= []
  while (rowKeysRef.current.length < definitionNode.options.length) {
    rowKeysRef.current.push(createBrowserUuid())
  }
  rowKeysRef.current.length = definitionNode.options.length

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-xs',
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background'
      )}
      style={{ width: WORKFLOW_NODE_WIDTH }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
      />
      <div className="flex items-center gap-1.5">
        <UserCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-medium">{definitionNode.title}</span>
        {statusDotClassName ? (
          <span
            className={cn('ml-auto size-2 shrink-0 rounded-full', statusDotClassName)}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <span className="truncate text-xs text-muted-foreground">{definitionNode.question}</span>
      <span className="truncate text-[11px] text-muted-foreground">
        {timeoutLabel(definitionNode.timeoutMs)}
      </span>
      <ul className="mt-1 space-y-1">
        {definitionNode.options.map((option, index) => (
          <li
            key={rowKeysRef.current[index]}
            className="relative flex items-center rounded-md border border-border bg-muted/20 px-2 py-1 pr-3"
          >
            <span className="min-w-0 flex-1 truncate text-xs">
              {option}
              {option !== '' && option === definitionNode.defaultOption ? (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {translate('auto.components.workflows.editor.ApprovalNode.default', '(default)')}
                </span>
              ) : null}
            </span>
            {routableIndices.has(index) ? (
              <Handle
                type="source"
                position={Position.Right}
                id={option}
                style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
