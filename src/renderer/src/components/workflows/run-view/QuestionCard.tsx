import React, { useState } from 'react'
import { CircleCheck, Loader2, MessageCircleQuestion, ShieldQuestion } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { workflowRunAnswer, type RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import type { RunQuestionView } from '../../../../../shared/workflows/workflow-run-types'
import {
  agentQuestionContext,
  approvalQuestionChoices
} from '../../../../../shared/workflows/workflow-question-choices'
import { trustQuestionSubject } from '../../../../../shared/workflows/workflow-trust-question-subject'
import TrustSourceDialog from '../roles/TrustSourceDialog'

export type QuestionCardProps = {
  question: RunQuestionView
  settings: RuntimeWorkflowSettings
}

/** Still awaiting a person, and safe to answer from here: an `escalated` question already sent
 *  its notification but hasn't hit its default/failure yet (FR-033/FR-033a). */
function isAnswerable(question: RunQuestionView): boolean {
  return question.state === 'pending' || question.state === 'escalated'
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

/** A question kind with no answer flow, or an answer flow whose payload didn't decode — the
 *  prompt only, so a run still shows *something* pending here rather than nothing. */
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

/** A settled (`answered`/`expired`) approval or agent question (FR-033 AS2, FR-033a AS6): the
 *  prompt, the recorded answer, and who answered it and when — `answeredBy`/`answeredAt` are
 *  absent for a question that expired with no default and no answer, in which case only the
 *  timeout note shows. */
function AnsweredQuestionSummary({
  question,
  answerText
}: {
  question: RunQuestionView
  answerText: string | undefined
}): React.JSX.Element {
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{question.prompt}</p>
      {answerText ? (
        <p className="text-sm text-foreground">{answerText}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.run-view.QuestionCard.timedOutUnanswered',
            'Timed out with no answer.'
          )}
        </p>
      )}
      {question.answeredBy && question.answeredAt ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.workflows.run-view.QuestionCard.answeredBy',
            'Answered by {{who}} at {{when}}',
            {
              who: question.answeredBy,
              when: new Date(question.answeredAt).toLocaleString()
            }
          )}
        </p>
      ) : null}
    </div>
  )
}

/** FR-033: a pending/escalated Approval — one button per option, answered via `optionId`. An
 *  `escalated` question already sent its notification but is still answerable until it expires. */
function ApprovalQuestionCard({
  question,
  settings
}: {
  question: RunQuestionView
  settings: RuntimeWorkflowSettings
}): React.JSX.Element {
  const [answering, setAnswering] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const choices = approvalQuestionChoices(question)

  if (!choices) {
    return <PendingQuestionSummary question={question} />
  }
  if (!isAnswerable(question)) {
    const chosen = choices.find((choice) => choice.id === question.answer)
    return (
      <AnsweredQuestionSummary question={question} answerText={chosen?.label ?? question.answer} />
    )
  }

  async function answer(optionId: string): Promise<void> {
    setAnswering(optionId)
    setError(undefined)
    try {
      await workflowRunAnswer(settings, {
        runId: question.runId,
        questionId: question.id,
        optionId
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnswering(undefined)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <CircleCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-semibold text-foreground">
          {translate(
            'auto.components.workflows.run-view.QuestionCard.approvalTitle',
            'Approval needed'
          )}
        </span>
        {question.state === 'escalated' ? (
          <Badge variant="destructive">
            {translate('auto.components.workflows.run-view.QuestionCard.escalated', 'Escalated')}
          </Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{question.prompt}</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <Button
            key={choice.id}
            type="button"
            size="sm"
            variant="outline"
            disabled={answering !== undefined}
            onClick={() => void answer(choice.id)}
          >
            {answering === choice.id ? <Loader2 className="animate-spin" /> : null}
            {choice.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** FR-033a: a pending/escalated agent question — free-text answered via `answer`, delivered back
 *  to the agent's existing session. Shows the agent's context when the engine included one. */
function AgentQuestionCard({
  question,
  settings
}: {
  question: RunQuestionView
  settings: RuntimeWorkflowSettings
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const context = agentQuestionContext(question)

  if (!isAnswerable(question)) {
    return <AnsweredQuestionSummary question={question} answerText={question.answer} />
  }

  async function submit(): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      await workflowRunAnswer(settings, {
        runId: question.runId,
        questionId: question.id,
        answer: trimmed
      })
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <MessageCircleQuestion
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="text-xs font-semibold text-foreground">
          {translate(
            'auto.components.workflows.run-view.QuestionCard.agentQuestionTitle',
            'The agent has a question'
          )}
        </span>
        {question.state === 'escalated' ? (
          <Badge variant="destructive">
            {translate('auto.components.workflows.run-view.QuestionCard.escalated', 'Escalated')}
          </Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{question.prompt}</p>
      {context ? <p className="text-xs text-muted-foreground italic">{context}</p> : null}
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={translate(
          'auto.components.workflows.run-view.QuestionCard.answerPlaceholder',
          'Type your answer…'
        )}
        className="min-h-16"
        disabled={submitting}
        aria-label={translate(
          'auto.components.workflows.run-view.QuestionCard.answerPlaceholder',
          'Type your answer…'
        )}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button
        type="button"
        size="sm"
        disabled={submitting || text.trim().length === 0}
        onClick={() => void submit()}
      >
        {submitting ? <Loader2 className="animate-spin" /> : null}
        {translate('auto.components.workflows.run-view.QuestionCard.answer', 'Answer')}
      </Button>
    </div>
  )
}

/**
 * Renders one `RunQuestionView` (data-model.md §workflow_run_questions), switched by `kind`:
 * `trust` (FR-018a) via a review dialog, `approval` (FR-033) via option buttons, `agent-question`
 * (FR-033a) via a free-text answer — each showing who answered and when once settled.
 */
export default function QuestionCard({ question, settings }: QuestionCardProps): React.JSX.Element {
  switch (question.kind) {
    case 'trust':
      return <TrustQuestionCard question={question} settings={settings} />
    case 'approval':
      return <ApprovalQuestionCard question={question} settings={settings} />
    case 'agent-question':
      return <AgentQuestionCard question={question} settings={settings} />
  }
}
