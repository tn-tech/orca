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

export type RunUnsavedChangesDialogProps = {
  open: boolean
  onSaveAndRun: () => void
  onCancel: () => void
}

/** F8: Run must never silently execute the on-disk file while the editor has unsaved edits — this
 *  is the only way past that state, no "run the old version" option. */
export default function RunUnsavedChangesDialog({
  open,
  onSaveAndRun,
  onCancel
}: RunUnsavedChangesDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.workflows.RunUnsavedChangesDialog.title',
              'Save before running?'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.workflows.RunUnsavedChangesDialog.description',
              'This workflow has unsaved changes. Running now would run the last saved version instead.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {translate('auto.components.workflows.RunUnsavedChangesDialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={onSaveAndRun}>
            {translate(
              'auto.components.workflows.RunUnsavedChangesDialog.saveAndRun',
              'Save and run'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
