import React, { useState } from 'react'
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

export type WorkflowDeleteDialogProps = {
  workflowName: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}

/** Confirms `workflow.delete` (FR-001) — deleting a file has no undo. */
export default function WorkflowDeleteDialog({
  workflowName,
  onOpenChange,
  onConfirm
}: WorkflowDeleteDialogProps): React.JSX.Element {
  const [deleting, setDeleting] = useState(false)

  const handleConfirm = async (): Promise<void> => {
    setDeleting(true)
    try {
      await onConfirm()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={workflowName !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.workflows.WorkflowDeleteDialog.title', 'Delete workflow?')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.workflows.WorkflowDeleteDialog.description',
              '"{{name}}" will be deleted from disk. This cannot be undone.',
              { name: workflowName ?? '' }
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('auto.components.workflows.WorkflowDeleteDialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={deleting} onClick={handleConfirm}>
            {translate('auto.components.workflows.WorkflowDeleteDialog.confirm', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
