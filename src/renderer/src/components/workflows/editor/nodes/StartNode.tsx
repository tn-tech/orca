import React from 'react'
import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StartNode as StartNodeDefinition } from '../../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../../shared/workflows/workflow-node-states'
import { WORKFLOW_NODE_HEIGHT } from '../workflow-auto-layout'
import { workflowNodeStatusDotClassName } from './workflow-node-run-status-style'

export type WorkflowStartNodeData = {
  definitionNode: StartNodeDefinition
  attemptState?: WorkflowAttemptState
}

export type WorkflowStartFlowNode = FlowNode<WorkflowStartNodeData, 'start'>

/** The graph's single entry point (data-model.md §1): a quiet pill, no inbound port. */
export default function StartNode({
  data,
  selected
}: NodeProps<WorkflowStartFlowNode>): React.JSX.Element {
  const statusDotClassName = workflowNodeStatusDotClassName(data.attemptState)
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border border-border bg-card px-4 text-card-foreground shadow-xs',
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background'
      )}
      style={{ height: WORKFLOW_NODE_HEIGHT, minWidth: 140 }}
    >
      <Play className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate text-sm font-medium">{data.definitionNode.title}</span>
      {statusDotClassName ? (
        <span
          className={cn('ml-auto size-2 shrink-0 rounded-full', statusDotClassName)}
          aria-hidden="true"
        />
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
      />
    </div>
  )
}
