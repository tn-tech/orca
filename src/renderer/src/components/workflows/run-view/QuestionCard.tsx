import React, { useState } from 'react'
import { ShieldQuestion } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import type { RunQuestionView } from '../../../../../shared/workflows/workflow-run-types'
import { trustQuestionSubject } from '../../../../../shared/workflows/workflow-trust-question-subject'
import TrustSourceDialog from '../roles/TrustSourceDialog'

export type QuestionCardProps = {
  question: RunQuestionView
  settings: RuntimeWorkflowSettings
}

/** FR-018a: a pending `trust` question, with a Review action that opens the same decision dialog
 *  the role editor uses, scoped to the question's own host so the decision lands on the right
 *  `workflow_source_trust` row instead of always `local`. A payload that doesn't decode falls
 *  back to the plain-prompt summary rather than disappearing (review note) — the run is still
 *  waiting on a person even if this client can't render the structured reason why. */
function TrustQuestionCard({
  question,
  settings
}: {
  question: RunQuestionView
  settings: RuntimeWorkflowSettings
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const subject = trustQuestionSubject(question)
  if (!subject) {
    return <PendingQuestionSummary question={question} />
  }
  return (
    <div className="space-y-2 rounded-md border border-workspace-status-review/40 bg-workspace-status-review/10 p-3">
      <div className="flex items-center gap-2">
        <ShieldQuestion
          className="size-4 shrink-0 text-workspace-status-review"
          aria-hidden="true"
        />
        <span className="text-xs font-semibold text-foreground">
          {translate(
            'auto.components.workflows.run-view.QuestionCard.trustTitle',
            'Trust required'
          )}
        </span>
        <Badge variant="hostContext">{subject.host}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{question.prompt}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {translate('auto.components.workflows.run-view.QuestionCard.review', 'Review')}
      </Button>
      <TrustSourceDialog
        open={open}
        settings={settings}
        source={subject.source}
        skills={subject.skills}
        agents={subject.agents}
        host={subject.host}
        onOpenChange={setOpen}
      />
    </div>
  )
}

/** A question kind US5 hasn't wired an answer flow for yet — the prompt only, so a run with an
 *  approval or agent question still shows *something* pending here rather than nothing. */
function PendingQuestionSummary({ question }: { question: RunQuestionView }): React.JSX.Element {
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3">
      <span className="text-xs font-semibold text-foreground">
        {translate(
          'auto.components.workflows.run-view.QuestionCard.pendingTitle',
          'Waiting on you'
        )}
      </span>
      <p className="text-xs text-muted-foreground">{question.prompt}</p>
    </div>
  )
}

/**
 * Renders one `RunQuestionView` (data-model.md §workflow_run_questions), switched by `kind`.
 * Only `trust` (FR-018a) has an answer flow today; `approval`/`agent-question` are US5's to wire
 * up, and fall back to a plain prompt display in the meantime.
 */
export default function QuestionCard({ question, settings }: QuestionCardProps): React.JSX.Element {
  switch (question.kind) {
    case 'trust':
      return <TrustQuestionCard question={question} settings={settings} />
    case 'approval':
    case 'agent-question':
      return <PendingQuestionSummary question={question} />
  }
}
