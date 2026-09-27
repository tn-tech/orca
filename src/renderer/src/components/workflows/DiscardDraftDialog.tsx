import React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'

export type DiscardDraftDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/** US6: confirms discarding an unsaved draft (never written to disk) before an action that would
 *  replace the editor's contents — opening another workflow, starting a new one, or a new draft. */
export default function DiscardDraftDialog({
  open,
  onOpenChange,
  onConfirm
}: DiscardDraftDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.workflows.DiscardDraftDialog.title',
              'Discard unsaved draft?'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.workflows.DiscardDraftDialog.description',
              "This draft hasn't been saved. Leaving it now discards it."
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('auto.components.workflows.DiscardDraftDialog.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {translate('auto.components.workflows.DiscardDraftDialog.confirm', 'Discard')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
