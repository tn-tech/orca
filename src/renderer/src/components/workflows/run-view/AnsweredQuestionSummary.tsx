import React from 'react'
import { translate } from '@/i18n/i18n'
import type { RunQuestionView } from '../../../../../shared/workflows/workflow-run-types'
import { APPROVAL_DEFAULT_ANSWERER } from '../../../../../shared/workflows/workflow-approval-question-subject'

export type AnsweredQuestionSummaryProps = {
  question: RunQuestionView
  answerText: string | undefined
  /** `questionExpiryReason`'s result for this question: any reason (the run or attempt ended,
   *  a newer question superseded it, …) reads as "Closed"; absent means a real deadline timeout. */
  noAnswerReason?: string
}

/** A settled (`answered`/`expired`) trust, approval or agent question (FR-033 AS2, FR-033a AS6):
 *  the prompt, the recorded answer, and who answered it and when. `answeredBy` equal to the
 *  engine's `APPROVAL_DEFAULT_ANSWERER` isn't a person, so it reads as "Default applied…" instead
 *  of "Answered by…". `answerText` absent means no one (and no default) ever answered — shown as
 *  "Timed out" only for a deadline timeout (no `noAnswerReason`), else the neutral "Closed". */
export default function AnsweredQuestionSummary({
  question,
  answerText,
  noAnswerReason
}: AnsweredQuestionSummaryProps): React.JSX.Element {
  const defaultApplied = question.answeredBy === APPROVAL_DEFAULT_ANSWERER
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{question.prompt}</p>
      {answerText ? (
        <p className="text-sm text-foreground">{answerText}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {noAnswerReason
            ? translate(
                'auto.components.workflows.run-view.QuestionCard.closedUnanswered',
                'Closed with no answer.'
              )
            : translate(
                'auto.components.workflows.run-view.QuestionCard.timedOutUnanswered',
                'Timed out with no answer.'
              )}
        </p>
      )}
      {defaultApplied && question.answeredAt ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.workflows.run-view.QuestionCard.defaultApplied',
            'Default applied after timeout at {{when}}',
            { when: new Date(question.answeredAt).toLocaleString() }
          )}
        </p>
      ) : question.answeredBy && question.answeredAt ? (
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
