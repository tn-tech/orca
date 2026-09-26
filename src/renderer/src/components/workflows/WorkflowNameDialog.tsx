import React, { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { WorkflowRunSource } from '../../../../shared/workflows/workflow-run-types'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'

/** Mirrors the host's `assertValidWorkflowName` (workflow-file-store.ts) so the dialog can refuse
 *  an obviously bad name before round-tripping to the host. */
function isWorkflowRunSource(value: string): value is WorkflowRunSource {
  return value === 'project' || value === 'personal'
}

function validateWorkflowNameInput(name: string): string | undefined {
  const trimmed = name.trim()
  if (!trimmed) {
    return translate('auto.components.workflows.WorkflowNameDialog.errorRequired', 'Enter a name.')
  }
  if (
    trimmed !== name ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..')
  ) {
    return translate(
      'auto.components.workflows.WorkflowNameDialog.errorInvalid',
      'Name cannot contain "/", "\\", ".." or leading/trailing spaces.'
    )
  }
  return undefined
}

export type WorkflowNameDialogProps = {
  open: boolean
  title: string
  description?: string
  initialName?: string
  submitLabel: string
  /** Fixes the storage location (duplicate keeps the original's); omit to let the user pick (create). */
  fixedSource?: WorkflowRunSource
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, source: WorkflowRunSource) => Promise<void>
}

/** Shared name-entry dialog for "New workflow" and "Duplicate" (FR-001, FR-012). */
export default function WorkflowNameDialog({
  open,
  title,
  description,
  initialName,
  submitLabel,
  fixedSource,
  onOpenChange,
  onSubmit
}: WorkflowNameDialogProps): React.JSX.Element {
  const nameId = useId()
  // Why no reset-on-`open` effect: the caller remounts this dialog (a fresh `key`) each time it
  // opens, so these initial values are only ever read once per open — see WorkflowListPane.
  const [name, setName] = useState(initialName ?? '')
  const [source, setSource] = useState<WorkflowRunSource>(fixedSource ?? 'project')
  const [error, setError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const validationError = validateWorkflowNameInput(name)
    if (validationError) {
      setError(validationError)
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      await onSubmit(name.trim(), source)
      onOpenChange(false)
    } catch (err) {
      setError(
        hasRuntimeRpcErrorCode(err, 'workflow_file_conflict') ||
          hasRuntimeRpcErrorCode(err, 'workflow_name_taken')
          ? translate(
              'auto.components.workflows.WorkflowNameDialog.errorNameTaken',
              'A workflow named "{{name}}" already exists there.',
              { name: name.trim() }
            )
          : err instanceof Error
            ? err.message
            : String(err)
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <div className="space-y-1">
              <Label htmlFor={nameId}>
                {translate('auto.components.workflows.WorkflowNameDialog.nameLabel', 'Name')}
              </Label>
              <Input
                id={nameId}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={error ? true : undefined}
              />
            </div>
            {fixedSource === undefined ? (
              <div className="space-y-1">
                <Label>
                  {translate(
                    'auto.components.workflows.WorkflowNameDialog.sourceLabel',
                    'Location'
                  )}
                </Label>
                <Select
                  value={source}
                  onValueChange={(value) => isWorkflowRunSource(value) && setSource(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project">
                      {translate(
                        'auto.components.workflows.WorkflowNameDialog.sourceProject',
                        'Project (shared, committed)'
                      )}
                    </SelectItem>
                    <SelectItem value="personal">
                      {translate(
                        'auto.components.workflows.WorkflowNameDialog.sourcePersonal',
                        'Personal (this machine only)'
                      )}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {translate('auto.components.workflows.WorkflowNameDialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
