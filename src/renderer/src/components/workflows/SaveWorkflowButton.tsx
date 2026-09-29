import React from 'react'
import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import DisabledReasonButton from './DisabledReasonButton'

export type SaveWorkflowButtonProps = {
  dirty: boolean
  isDraft: boolean
  saving: boolean
  /** F7: only fields the host can't store gate Save; graph errors save as a draft and block Run. */
  invalidFields: boolean
  onClick: () => void
}

/** Extracted out of `WorkflowsPage.tsx` to keep that file under the line budget and make the
 *  reason logic independently testable. */
export default function SaveWorkflowButton({
  dirty,
  isDraft,
  saving,
  invalidFields,
  onClick
}: SaveWorkflowButtonProps): React.JSX.Element {
  const reason = invalidFields
    ? translate(
        'auto.components.workflows.SaveWorkflowButton.invalidFields',
        'Fill in the fields listed under Problems before saving.'
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
    <DisabledReasonButton reason={reason} onClick={onClick} tooltipSide="bottom">
      {saving ? <Loader2 className="animate-spin" /> : null}
      {translate('auto.components.workflows.WorkflowsPage.save', 'Save')}
    </DisabledReasonButton>
  )
}
