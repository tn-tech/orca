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
  /** 'draft': an agent-drafted workflow never written to disk (US6). 'changes': dirty unsaved
   *  edits to an ordinary, already-saved workflow. */
  reason: 'draft' | 'changes'
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/** Confirms discarding unsaved content before an action that would replace the editor's contents
 *  — opening another workflow, starting a new one, or a new draft (US6 and the general case). */
export default function DiscardDraftDialog({
  open,
  reason,
  onOpenChange,
  onConfirm
}: DiscardDraftDialogProps): React.JSX.Element {
  const title =
    reason === 'draft'
      ? translate('auto.components.workflows.DiscardDraftDialog.title', 'Discard unsaved draft?')
      : translate(
          'auto.components.workflows.DiscardDraftDialog.titleChanges',
          'Discard unsaved changes?'
        )
  const description =
    reason === 'draft'
      ? translate(
          'auto.components.workflows.DiscardDraftDialog.description',
          "This draft hasn't been saved. Leaving it now discards it."
        )
      : translate(
          'auto.components.workflows.DiscardDraftDialog.descriptionChanges',
          'This workflow has unsaved changes. Leaving it now discards them.'
        )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
