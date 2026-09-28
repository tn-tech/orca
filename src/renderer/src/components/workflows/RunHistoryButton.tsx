import React from 'react'
import { History } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import DisabledReasonButton from './DisabledReasonButton'

export type RunHistoryButtonProps = {
  /** `undefined` means enabled; the caller picks the reason (no project vs. no saved file). */
  reason: string | undefined
  onClick: () => void
}

export default function RunHistoryButton({
  reason,
  onClick
}: RunHistoryButtonProps): React.JSX.Element {
  return (
    <DisabledReasonButton variant="outline" reason={reason} onClick={onClick} tooltipSide="bottom">
      <History />
      {translate('auto.components.workflows.WorkflowsPage.runHistory', 'History')}
    </DisabledReasonButton>
  )
}
