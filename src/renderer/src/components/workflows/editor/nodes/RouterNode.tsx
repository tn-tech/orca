import React from 'react'
import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react'
import { Waypoints } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { RouterNode as RouterNodeDefinition } from '../../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../../shared/workflows/workflow-node-states'
import { WORKFLOW_NODE_WIDTH } from '../workflow-auto-layout'
import { workflowNodeStatusDotClassName } from './workflow-node-run-status-style'

export type WorkflowRouterNodeData = {
  definitionNode: RouterNodeDefinition
  /** Resolved `overrides.agent ?? role.agent` (WorkflowCanvas has the roles map, this node doesn't). */
  agentLabel?: string
  attemptState?: WorkflowAttemptState
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
        <Waypoints className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-medium">{definitionNode.title}</span>
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
        {definitionNode.choices.map((choice) => (
          <li
            key={choice}
            className="relative flex items-center rounded-md border border-border bg-muted/20 px-2 py-1 pr-3"
          >
            <span className="min-w-0 flex-1 truncate text-xs">{choice}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={choice}
              style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
