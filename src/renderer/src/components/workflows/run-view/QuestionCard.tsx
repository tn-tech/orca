import React, { useState } from 'react'
import { CircleCheck, Loader2, MessageCircleQuestion, ShieldQuestion } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import { workflowRunAnswer, type RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import type { RunQuestionView } from '../../../../../shared/workflows/workflow-run-types'
import { agentQuestionContext } from '../../../../../shared/workflows/workflow-agent-question-subject'
import { approvalQuestionSubject } from '../../../../../shared/workflows/workflow-approval-question-subject'
import { trustQuestionSubject } from '../../../../../shared/workflows/workflow-trust-question-subject'
import AnsweredQuestionSummary from './AnsweredQuestionSummary'
import TrustSourceDialog from '../roles/TrustSourceDialog'

export type QuestionCardProps = {
  question: RunQuestionView
  settings: RuntimeWorkflowSettings
  /** Why an `expired` question had no answer (`approvalExpiryReason`): `'run_ended'` shows
   *  "Closed" instead of "Timed out". Only meaningful once `question.state === 'expired'`. */
  expiredReason?: string
}

/** Still awaiting a person, and safe to answer from here: an `escalated` question already sent
 *  its notification but hasn't hit its default/failure yet (FR-033/FR-033a). */
function isAnswerable(question: RunQuestionView): boolean {
  return question.state === 'pending' || question.state === 'escalated'
}

/** A pending question overdue its escalation (FR-033/FR-033a): still answerable, so the review
 *  and attention tokens `TrustQuestionCard` already uses (not `destructive`, reserved for
 *  irreversible actions and real errors — STYLEGUIDE). */
function EscalatedBadge(): React.JSX.Element {
  return (
    <Badge variant="review">
      {translate('auto.components.workflows.run-view.QuestionCard.escalated', 'Escalated')}
    </Badge>
  )
}

/** `workflow.run.answer`/`workflow.run.sendMessage` predate some hosts; a host that lacks them
 *  answers `method_not_found`. Shown once and left showing — retrying can't succeed either. */
function UnsupportedNotice(): React.JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">
      {translate(
        'auto.components.workflows.run-view.QuestionCard.methodNotSupported',
        "Answering isn't available on this host yet."
      )}
    </p>
  )
}

function trustAnswerLabel(answer: string | undefined): string | undefined {
  if (answer === 'trusted') {
    return translate('auto.components.workflows.run-view.QuestionCard.trustedAnswer', 'Trusted')
  }
  if (answer === 'refused') {
    return translate('auto.components.workflows.run-view.QuestionCard.refusedAnswer', 'Refused')
  }
  return undefined
}

/** FR-018a: a pending/escalated `trust` question, with a Review action that opens the same
 *  decision dialog the role editor uses, scoped to the question's own host so the decision lands
 *  on the right `workflow_source_trust` row instead of always `local`. A payload that doesn't
 *  decode falls back to the plain-prompt summary rather than disappearing (review note) — the run
 *  is still waiting on a person even if this client can't render the structured reason why. */
function TrustQuestionCard({
  question,
  settings
}: {
  question: RunQuestionView
  settings: RuntimeWorkflowSettings
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  if (!isAnswerable(question)) {
    return (
      <AnsweredQuestionSummary question={question} answerText={trustAnswerLabel(question.answer)} />
    )
  }
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

/** FR-033: a pending/escalated Approval — one button per option (`approvalQuestionSubject`,
 *  `workflow-approval-question-subject.ts`, the same decoder the engine validates answers
 *  against), answered via `optionId`. Shows the configured default so a person can tell what
 *  happens if no one answers in time. */
function ApprovalQuestionCard({
  question,
  settings,
  expiredReason
}: {
  question: RunQuestionView
  settings: RuntimeWorkflowSettings
  expiredReason?: string
}): React.JSX.Element {
  const [answering, setAnswering] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [unsupported, setUnsupported] = useState(false)
  const subject = approvalQuestionSubject(question)

  if (!isAnswerable(question)) {
    return (
      <AnsweredQuestionSummary
        question={question}
        answerText={question.answer}
        noAnswerReason={expiredReason}
      />
    )
  }
  if (!subject) {
    return <PendingQuestionSummary question={question} />
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
      if (hasRuntimeRpcErrorCode(err, 'method_not_found')) {
        setUnsupported(true)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
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
        {question.state === 'escalated' ? <EscalatedBadge /> : null}
      </div>
      <p className="text-xs text-muted-foreground">{question.prompt}</p>
      {subject.defaultOption ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.workflows.run-view.QuestionCard.defaultOnTimeout',
            'Default on timeout: {{option}}',
            { option: subject.defaultOption }
          )}
        </p>
      ) : null}
      {unsupported ? (
        <UnsupportedNotice />
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {subject.options.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant="outline"
            disabled={unsupported || answering !== undefined}
            onClick={() => void answer(option)}
          >
            {answering === option ? <Loader2 className="animate-spin" /> : null}
            {option}
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
  settings,
  expiredReason
}: {
  question: RunQuestionView
  settings: RuntimeWorkflowSettings
  expiredReason?: string
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [unsupported, setUnsupported] = useState(false)
  const context = agentQuestionContext(question)

  if (!isAnswerable(question)) {
    return (
      <AnsweredQuestionSummary
        question={question}
        answerText={question.answer}
        noAnswerReason={expiredReason}
      />
    )
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
      if (hasRuntimeRpcErrorCode(err, 'method_not_found')) {
        setUnsupported(true)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
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
        {question.state === 'escalated' ? <EscalatedBadge /> : null}
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
        disabled={submitting || unsupported}
        aria-label={translate(
          'auto.components.workflows.run-view.QuestionCard.answerPlaceholder',
          'Type your answer…'
        )}
      />
      {unsupported ? (
        <UnsupportedNotice />
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
      <Button
        type="button"
        size="sm"
        disabled={submitting || unsupported || text.trim().length === 0}
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
export default function QuestionCard({
  question,
  settings,
  expiredReason
}: QuestionCardProps): React.JSX.Element {
  switch (question.kind) {
    case 'trust':
      return <TrustQuestionCard question={question} settings={settings} />
    case 'approval':
      return (
        <ApprovalQuestionCard
          question={question}
          settings={settings}
          expiredReason={expiredReason}
        />
      )
    case 'agent-question':
      return (
        <AgentQuestionCard question={question} settings={settings} expiredReason={expiredReason} />
      )
  }
}
