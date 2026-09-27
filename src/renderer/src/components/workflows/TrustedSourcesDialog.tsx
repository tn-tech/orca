import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import TrustedSourcesList from './TrustedSourcesList'

export type TrustedSourcesDialogProps = {
  open: boolean
  settings: RuntimeWorkflowSettings
  onOpenChange: (open: boolean) => void
}

/** The Workflows page's shortcut to the same trust list `WorkflowsTrustExperimentalSetting`
 *  (Settings > Experimental) shows — FR-018a only requires it be revocable "from settings", not
 *  that Settings be the only door to it. */
export default function TrustedSourcesDialog({
  open,
  settings,
  onOpenChange
}: TrustedSourcesDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.workflows.TrustedSourcesDialog.title',
              'Trusted skill sources'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.workflows.TrustedSourcesDialog.description',
              'One decision per plugin source and host (FR-018a). Revoking asks again the next time a run needs it there.'
            )}
          </DialogDescription>
        </DialogHeader>
        {open ? <TrustedSourcesList settings={settings} /> : null}
      </DialogContent>
    </Dialog>
  )
}
