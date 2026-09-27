import React from 'react'
import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { ReflectionNode as ReflectionNodeDefinition } from '../../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../../shared/workflows/workflow-node-states'
import { WORKFLOW_NODE_HEIGHT, WORKFLOW_NODE_WIDTH } from '../workflow-auto-layout'
import { workflowNodeStatusDotClassName } from './workflow-node-run-status-style'

export type WorkflowReflectionNodeData = {
  definitionNode: ReflectionNodeDefinition
  /** Resolved `overrides.agent ?? role.agent` (WorkflowCanvas has the roles map, this node doesn't). */
  agentLabel?: string
  attemptState?: WorkflowAttemptState
  /** The worktree the attempt's dispatch ran in (FR-035, "workspace used per node"); absent
   *  before the node has run. */
  workspaceLabel?: string
}

export type WorkflowReflectionFlowNode = FlowNode<WorkflowReflectionNodeData, 'reflection'>

/** Dispatches a role to review the run and propose role changes (data-model.md §1 ReflectionNode,
 *  US7, FR-034) — the same role-dispatch shape as `AgentNode`/`RouterNode`, no fixed result
 *  contract shown here since it never varies (contracts/agent-brief.md). */
export default function ReflectionNode({
  data,
  selected
}: NodeProps<WorkflowReflectionFlowNode>): React.JSX.Element {
  const { definitionNode, agentLabel, attemptState, workspaceLabel } = data
  const statusDotClassName = workflowNodeStatusDotClassName(attemptState)
  const agentText =
    agentLabel ??
    translate('auto.components.workflows.editor.ReflectionNode.noAgent', 'No agent selected')

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-xs',
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background'
      )}
      style={{ width: WORKFLOW_NODE_WIDTH, minHeight: WORKFLOW_NODE_HEIGHT }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
      />
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
            'auto.components.workflows.editor.ReflectionNode.workspace',
            'Workspace: {{name}}',
            { name: workspaceLabel }
          )}
        </span>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
      />
    </div>
  )
}
