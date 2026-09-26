import React from 'react'
import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react'
import { GitMerge } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { JoinNode as JoinNodeDefinition } from '../../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../../shared/workflows/workflow-node-states'
import { WORKFLOW_NODE_HEIGHT, WORKFLOW_NODE_WIDTH } from '../workflow-auto-layout'
import { workflowNodeStatusDotClassName } from './workflow-node-run-status-style'

export type WorkflowJoinNodeData = {
  definitionNode: JoinNodeDefinition
  attemptState?: WorkflowAttemptState
}

export type WorkflowJoinFlowNode = FlowNode<WorkflowJoinNodeData, 'join'>

function joinPolicyLabel(policy: JoinNodeDefinition['policy']): string {
  if (policy === 'all') {
    return translate('auto.components.workflows.editor.JoinNode.policyAll', 'Wait all')
  }
  if (policy === 'any') {
    return translate('auto.components.workflows.editor.JoinNode.policyAny', 'Wait any')
  }
  return translate('auto.components.workflows.editor.JoinNode.policyQuorum', 'Quorum {{n}}', {
    n: policy.quorum
  })
}

/** Fans multiple branches back together (data-model.md §1 JoinNode, FR-007): one incoming edge
 *  per branch into a single target port, the configured policy shown as a badge. Per-branch
 *  outcome is a run-view concern (`AttemptPanel`), not shown on the canvas card itself. */
export default function JoinNode({
  data,
  selected
}: NodeProps<WorkflowJoinFlowNode>): React.JSX.Element {
  const { definitionNode, attemptState } = data
  const statusDotClassName = workflowNodeStatusDotClassName(attemptState)

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
        <GitMerge className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-medium">{definitionNode.title}</span>
        {statusDotClassName ? (
          <span
            className={cn('ml-auto size-2 shrink-0 rounded-full', statusDotClassName)}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <Badge variant="secondary">{joinPolicyLabel(definitionNode.policy)}</Badge>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
      />
    </div>
  )
}
