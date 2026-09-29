import React, { useRef } from 'react'
import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react'
import { Waypoints } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { RouterNode as RouterNodeDefinition } from '../../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../../shared/workflows/workflow-node-states'
import { measureWorkflowNodeSize } from '../workflow-auto-layout'
import { routableChoiceIndices } from '../workflow-router-choices'
import { workflowNodeStatusDotClassName } from './workflow-node-run-status-style'
import type { WorkflowNodeProblemSummary } from '../workflow-node-problem-summary'
import WorkflowNodeProblemIndicator from './WorkflowNodeProblemIndicator'

export type WorkflowRouterNodeData = {
  definitionNode: RouterNodeDefinition
  /** Resolved `overrides.agent ?? role.agent` (WorkflowCanvas has the roles map, this node doesn't). */
  agentLabel?: string
  attemptState?: WorkflowAttemptState
  problem?: WorkflowNodeProblemSummary
  /** The worktree the attempt's dispatch ran in (FR-035, "workspace used per node"); absent
   *  before the node has run. */
  workspaceLabel?: string
}

export type WorkflowRouterFlowNode = FlowNode<WorkflowRouterNodeData, 'router'>

/** Chooses among fixed outgoing edges by agent decision (data-model.md §1 RouterNode, FR-029):
 *  one source Handle per choice, `id` equal to the choice text so it matches `Edge.fromPort`. */
export default function RouterNode({
  data,
  selected
}: NodeProps<WorkflowRouterFlowNode>): React.JSX.Element {
  const { definitionNode, agentLabel, attemptState, workspaceLabel } = data
  const statusDotClassName = workflowNodeStatusDotClassName(attemptState)
  const agentText =
    agentLabel ??
    translate('auto.components.workflows.editor.RouterNode.noAgent', 'No agent selected')
  // Two unedited "Add choice" rows share the text `''`, and a user can retype one to match
  // another — only the first occurrence of each text gets a Handle (review round 1, finding 2):
  // a duplicate `id` would leave React Flow to guess which Handle an edge actually connects to.
  const routableIndices = routableChoiceIndices(definitionNode.choices)
  // Why: choice text alone can't key these rows (it can repeat or be blank) and there's no other
  // per-choice id — a per-slot uuid keeps `key` off the bare array index
  // (react-doctor/no-array-index-as-key) despite this row having no local state to protect.
  const rowKeysRef = useRef<string[]>(undefined!)
  rowKeysRef.current ??= []
  while (rowKeysRef.current.length < definitionNode.choices.length) {
    rowKeysRef.current.push(createBrowserUuid())
  }
  rowKeysRef.current.length = definitionNode.choices.length
  // F10: same formula `computeAutoLayout` reserves space with (grows with the choice count), so
  // this card can't render taller than the box dagre laid it out in.
  const { width, height } = measureWorkflowNodeSize(definitionNode)

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-xs',
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background'
      )}
      style={{ width, minHeight: height }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
      />
      <div className="flex items-center gap-1.5">
        <Waypoints className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-medium">{definitionNode.title}</span>
        <WorkflowNodeProblemIndicator problem={data.problem} />
        {statusDotClassName ? (
          <span
            className={cn('ml-auto size-2 shrink-0 rounded-full', statusDotClassName)}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <span className="truncate text-xs text-muted-foreground">{agentText}</span>
      {workspaceLabel ? (
        <span className="truncate text-[11px] text-muted-foreground">
          {translate(
            'auto.components.workflows.editor.RouterNode.workspace',
            'Workspace: {{name}}',
            { name: workspaceLabel }
          )}
        </span>
      ) : null}
      <ul className="mt-1 space-y-1">
        {definitionNode.choices.map((choice, index) => (
          <li
            key={rowKeysRef.current[index]}
            className="relative flex items-center rounded-md border border-border bg-muted/20 px-2 py-1 pr-3"
          >
            <span className="min-w-0 flex-1 truncate text-xs">{choice}</span>
            {routableIndices.has(index) ? (
              <Handle
                type="source"
                position={Position.Right}
                id={choice}
                style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
