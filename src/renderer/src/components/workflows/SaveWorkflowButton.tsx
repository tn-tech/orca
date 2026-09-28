import React from 'react'
import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import DisabledReasonButton from './DisabledReasonButton'

export type SaveWorkflowButtonProps = {
  dirty: boolean
  isDraft: boolean
  saving: boolean
  /** FR-009: a blocking validation error also gates Save (`WorkflowsPage.tsx`). */
  blockingProblems: boolean
  onClick: () => void
}

/** F5: Save's disabled state used to give no reason. Extracted out of `WorkflowsPage.tsx` to keep
 *  that file under the line budget and make the reason logic independently testable. */
export default function SaveWorkflowButton({
  dirty,
  isDraft,
  saving,
  blockingProblems,
  onClick
}: SaveWorkflowButtonProps): React.JSX.Element {
  const reason = blockingProblems
    ? translate(
        'auto.components.workflows.WorkflowsPage.saveBlocked',
        'Fix the problems below before saving.'
      )
    : saving
      ? translate('auto.components.workflows.SaveWorkflowButton.saving', 'Saving…')
      : !dirty && !isDraft
        ? translate(
            'auto.components.workflows.SaveWorkflowButton.nothingToSave',
            'No changes to save yet.'
          )
        : undefined

  return (
    <DisabledReasonButton reason={reason} onClick={onClick}>
      {saving ? <Loader2 className="animate-spin" /> : null}
      {translate('auto.components.workflows.WorkflowsPage.save', 'Save')}
    </DisabledReasonButton>
  )
}
