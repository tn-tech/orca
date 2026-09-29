import React from 'react'
import { translate } from '@/i18n/i18n'
import type {
  RuntimeWorkflowSettings,
  WorkflowRunSnapshotView
} from '@/runtime/runtime-workflow-client'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { questionExpiryReason } from '../../../../../shared/workflows/workflow-question-expiry-reason'
import QuestionCard from './QuestionCard'

export type RunPendingPromptsProps = {
  definition: Workflow
  snapshot: WorkflowRunSnapshotView
  settings: RuntimeWorkflowSettings
  onSelectNode: (nodeId: string) => void
}

/** F9: every approval/question/trust prompt the shown run is waiting on, surfaced at run level so
 *  it isn't hidden until the user finds and selects the Waiting node. */
export default function RunPendingPrompts({
  definition,
  snapshot,
  settings,
  onSelectNode
}: RunPendingPromptsProps): React.JSX.Element | null {
  const pending = snapshot.questions.filter(
    (question) => question.state === 'pending' || question.state === 'escalated'
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
        const nodeId = snapshot.attempts.find(
          (attempt) => attempt.id === question.attemptId
        )?.nodeId
        const nodeTitle = definition.nodes.find((node) => node.id === nodeId)?.title
        return (
          <div key={question.id} className="space-y-1">
            {nodeId ? (
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
                onClick={() => onSelectNode(nodeId)}
              >
                {nodeTitle ?? nodeId}
              </button>
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
