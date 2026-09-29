import React from 'react'
import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react'
import { Repeat } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { LoopNode as LoopNodeDefinition } from '../../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../../shared/workflows/workflow-node-states'
import { workflowNodeStatusDotClassName } from './workflow-node-run-status-style'
import type { WorkflowNodeProblemSummary } from '../workflow-node-problem-summary'
import WorkflowNodeProblemIndicator from './WorkflowNodeProblemIndicator'

export type WorkflowLoopNodeData = {
  definitionNode: LoopNodeDefinition
  attemptState?: WorkflowAttemptState
  problem?: WorkflowNodeProblemSummary
  /** The loop's currently active iteration in the run view (FR-035); absent while plain editing. */
  iteration?: number
  /** Container box, computed by `WorkflowCanvas` from the body nodes' current positions. */
  width: number
  height: number
}

export type WorkflowLoopFlowNode = FlowNode<WorkflowLoopNodeData, 'loop'>

/**
 * Loop container (data-model.md §1 LoopNode): a dashed box that its body nodes render inside as
 * React Flow parent/child nodes (`WorkflowCanvas` assigns each body node `parentId: loop.id` and
 * a position relative to this box). The header carries the run view's iteration badge (FR-035)
 * and flags a missing cap inline, ahead of the same problem in `ValidationProblemsPanel` (US2 AS4).
 */
export default function LoopNode({
  data,
  selected
}: NodeProps<WorkflowLoopFlowNode>): React.JSX.Element {
  const { definitionNode, attemptState, iteration, width, height } = data
  const statusDotClassName = workflowNodeStatusDotClassName(attemptState)
  const missingCap = definitionNode.maxIterations < 1

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border border-dashed border-border bg-muted/10',
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background'
      )}
      style={{ width, height }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
      />
      <div className="flex shrink-0 items-center gap-1.5 rounded-t-[7px] border-b border-dashed border-border bg-card px-3 py-1.5 text-card-foreground">
        <Repeat className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-medium">{definitionNode.title}</span>
        <WorkflowNodeProblemIndicator problem={data.problem} />
        {iteration !== undefined ? (
          <Badge variant="secondary">
            {translate(
              'auto.components.workflows.editor.LoopNode.iteration',
              'Iteration {{n}} / {{max}}',
              { n: iteration, max: definitionNode.maxIterations }
            )}
          </Badge>
        ) : null}
        {missingCap ? (
          <Badge variant="destructive">
            {translate('auto.components.workflows.editor.LoopNode.noCap', 'No cap set')}
          </Badge>
        ) : null}
        {statusDotClassName ? (
          <span
            className={cn('ml-auto size-2 shrink-0 rounded-full', statusDotClassName)}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="exit"
        style={{ background: 'var(--border)', borderColor: 'var(--border)' }}
      />
    </div>
  )
}
