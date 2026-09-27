import React from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { WorkflowAttemptState } from '../../../../../shared/workflows/workflow-node-states'
import { workflowNodeStatusDotClassName } from '../editor/nodes/workflow-node-run-status-style'

/** A cancelled attempt (including a Join settled `join_skipped`) isn't a failure (review note):
 *  only `failed` gets the destructive treatment. */
export function attemptReasonClassName(state: WorkflowAttemptState): string {
  return state === 'failed' ? 'text-destructive' : 'text-muted-foreground'
}

/** `join_skipped`/`approval_timed_out`/`approval_rejected` are machine reason codes
 *  (`workflow-join-settlement.ts`'s `JOIN_SKIPPED_REASON`, `workflow-approval-deadlines.ts`'s
 *  `APPROVAL_TIMED_OUT_REASON`, `workflow-approval-rejection.ts`'s `APPROVAL_REJECTED_REASON`),
 *  not copy meant to be read as-is (review note) — every other `failureReason` is already a
 *  free-text message from the engine. */
export function attemptReasonLabel(failureReason: string): string {
  switch (failureReason) {
    case 'join_skipped':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.reasonJoinSkipped',
        'Every branch was skipped.'
      )
    case 'approval_timed_out':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.reasonApprovalTimedOut',
        'The approval timed out with no answer.'
      )
    case 'approval_rejected':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.reasonApprovalRejected',
        'The approval was answered with an option that stops the run.'
      )
    default:
      return failureReason
  }
}

/** FR-032's exact vocabulary; every `WorkflowAttemptState` gets a case. */
export function attemptStateLabel(state: WorkflowAttemptState): string {
  switch (state) {
    case 'pending':
      return translate('auto.components.workflows.run-view.AttemptPanel.statePending', 'Pending')
    case 'provisioning':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.stateProvisioning',
        'Provisioning'
      )
    case 'running':
      return translate('auto.components.workflows.run-view.AttemptPanel.stateRunning', 'Running')
    case 'waiting':
      return translate('auto.components.workflows.run-view.AttemptPanel.stateWaiting', 'Waiting')
    case 'completed':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.stateCompleted',
        'Completed'
      )
    case 'failed':
      return translate('auto.components.workflows.run-view.AttemptPanel.stateFailed', 'Failed')
    case 'skipped':
      return translate('auto.components.workflows.run-view.AttemptPanel.stateSkipped', 'Skipped')
    case 'cancelled':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.stateCancelled',
        'Cancelled'
      )
    case 'unverifiable':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.stateUnverifiable',
        'Unverifiable'
      )
  }
}

/** The status dot + label pair shown for an attempt's current state (FR-032), reused by
 *  `AttemptPanel`'s header and `AttemptIterationHistory`'s per-iteration rows. */
export default function AttemptStateBadge({
  state
}: {
  state: WorkflowAttemptState
}): React.JSX.Element {
  const dotClassName = workflowNodeStatusDotClassName(state)
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
      {dotClassName ? (
        <span className={cn('size-2 rounded-full', dotClassName)} aria-hidden="true" />
      ) : null}
      {attemptStateLabel(state)}
    </span>
  )
}
