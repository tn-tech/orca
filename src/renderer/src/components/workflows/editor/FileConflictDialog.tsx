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

export type WorkflowFileConflictReason =
  /** This client's own save was refused because the on-disk revision moved underneath it. */
  | 'save'
  /** The file changed on disk while this client had unsaved local edits open. */
  | 'external'

export type FileConflictDialogProps = {
  open: boolean
  workflowName: string
  reason: WorkflowFileConflictReason
  /** Discards local edits and adopts the on-disk content. */
  onReload: () => void
  /** Keeps local edits and writes them over whatever is on disk now. */
  onOverwrite: () => void
  onCancel: () => void
}

/**
 * FR-012 edge case ("two users edit the same workflow file"): the workflow file changed on disk
 * since it was last read here, so neither version can be silently kept — the user picks reload
 * (their edits) or overwrite (theirs wins).
 */
export default function FileConflictDialog({
  open,
  workflowName,
  reason,
  onReload,
  onOverwrite,
  onCancel
}: FileConflictDialogProps): React.JSX.Element {
  const description =
    reason === 'save'
      ? translate(
          'auto.components.workflows.editor.FileConflictDialog.descriptionSave',
          '"{{name}}" changed on disk since it was opened, so this save was not written. Reload to see the newer version, or overwrite it with your changes.',
          { name: workflowName }
        )
      : translate(
          'auto.components.workflows.editor.FileConflictDialog.descriptionExternal',
          '"{{name}}" changed on disk while you had unsaved changes open. Reload to see the newer version, or overwrite it with your changes.',
          { name: workflowName }
        )
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.workflows.editor.FileConflictDialog.title',
              'This workflow changed on disk'
            )}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {translate(
              'auto.components.workflows.editor.FileConflictDialog.cancel',
              'Keep editing'
            )}
          </Button>
          <Button type="button" variant="outline" onClick={onReload}>
            {translate('auto.components.workflows.editor.FileConflictDialog.reload', 'Reload')}
          </Button>
          <Button type="button" onClick={onOverwrite}>
            {translate(
              'auto.components.workflows.editor.FileConflictDialog.overwrite',
              'Overwrite'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
