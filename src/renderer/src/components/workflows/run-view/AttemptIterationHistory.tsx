import React from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { NodeAttemptView } from '../../../../../shared/workflows/workflow-run-types'
import { InspectorField } from '../editor/InspectorField'
import AttemptStateBadge, { attemptReasonClassName, attemptReasonLabel } from './AttemptStateBadge'

/** One row per completed/attempted loop iteration (FR-035, US2 AS1/AS3): state plus a compact
 *  result/failure summary, so a rejected-then-approved review loop's history stays visible after
 *  `AttemptPanel` moves on to showing the latest attempt above. */
function IterationRow({ attempt }: { attempt: NodeAttemptView }): React.JSX.Element {
  return (
    <li className="rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">
          {translate(
            'auto.components.workflows.run-view.AttemptPanel.iterationLabel',
            'Iteration {{n}}',
            { n: attempt.iteration }
          )}
        </span>
        <AttemptStateBadge state={attempt.state} />
      </div>
      {attempt.resultJson !== undefined ? (
        <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/20 p-2 font-mono text-[11px] text-muted-foreground scrollbar-sleek">
          {JSON.stringify(attempt.resultJson, null, 2)}
        </pre>
      ) : null}
      {attempt.failureReason ? (
        <p className={cn('mt-1.5 text-[11px]', attemptReasonClassName(attempt.state))}>
          {attemptReasonLabel(attempt.failureReason, attempt.failureCode)}
        </p>
      ) : null}
    </li>
  )
}

export type AttemptIterationHistoryProps = { iterations: readonly NodeAttemptView[] }

/** The per-iteration history for a node with more than one recorded iteration; `AttemptPanel`
 *  only renders this once `iterations.length > 1`. */
export default function AttemptIterationHistory({
  iterations
}: AttemptIterationHistoryProps): React.JSX.Element {
  return (
    <InspectorField
      label={translate('auto.components.workflows.run-view.AttemptPanel.iterations', 'Iterations')}
    >
      <ul className="space-y-1.5">
        {iterations.map((iterationAttempt) => (
          <IterationRow key={iterationAttempt.id} attempt={iterationAttempt} />
        ))}
      </ul>
    </InspectorField>
  )
}
