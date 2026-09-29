import React from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type {
  RuntimeWorkflowSettings,
  WorkflowRunSnapshotView
} from '@/runtime/runtime-workflow-client'
import { questionExpiryReason } from '../../../../../shared/workflows/workflow-question-expiry-reason'
import QuestionCard from './QuestionCard'

export type RunPendingPromptsProps = {
  snapshot: WorkflowRunSnapshotView
  settings: RuntimeWorkflowSettings
  /** The node whose attempt panel is open; its questions show there, not here. */
  selectedNodeId?: string
  onSelectNode: (nodeId: string) => void
}

/** F9: every approval/question/trust prompt the shown run is waiting on, surfaced at run level so
 *  it isn't hidden until the user finds and selects the Waiting node. */
export default function RunPendingPrompts({
  snapshot,
  settings,
  selectedNodeId,
  onSelectNode
}: RunPendingPromptsProps): React.JSX.Element | null {
  const nodeIdOf = (attemptId: string): string | undefined =>
    snapshot.attempts.find((attempt) => attempt.id === attemptId)?.nodeId
  const pending = snapshot.questions.filter(
    (question) =>
      (question.state === 'pending' || question.state === 'escalated') &&
      (selectedNodeId === undefined || nodeIdOf(question.attemptId) !== selectedNodeId)
  )
  if (pending.length === 0) {
    return null
  }
  return (
    <section
      aria-label={translate(
        'auto.components.workflows.run-view.RunPendingPrompts.title',
        'Waiting for you'
      )}
      className="max-h-60 shrink-0 space-y-2 overflow-y-auto scrollbar-sleek border-b border-border bg-muted/20 px-3 py-2 md:px-5"
    >
      {pending.map((question) => {
        const nodeId = nodeIdOf(question.attemptId)
        const nodeTitle = snapshot.workflowSnapshot.nodes.find((node) => node.id === nodeId)?.title
        return (
          <div key={question.id} className="space-y-1">
            {nodeId ? (
              <Button type="button" variant="link" size="xs" onClick={() => onSelectNode(nodeId)}>
                {nodeTitle ?? nodeId}
              </Button>
            ) : null}
            <QuestionCard
              question={question}
              settings={settings}
              expiredReason={questionExpiryReason(snapshot.events, question.id)}
            />
          </div>
        )
      })}
    </section>
  )
}
