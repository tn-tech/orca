import React, { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { translate } from '@/i18n/i18n'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import { workflowImportRole, type RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import type { Role } from '../../../../../shared/workflows/workflow-definition-types'

export type ImportRoleDialogProps = {
  open: boolean
  repo: string
  settings: RuntimeWorkflowSettings
  /** Pre-filled for a re-import (FR-016): update an already-imported role from its own source. */
  initialSource?: string
  initialRoleName?: string
  onOpenChange: (open: boolean) => void
  onImported: (role: Role) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function allowlistPathFromData(data: unknown): string | undefined {
  return isRecord(data) && typeof data.allowlistPath === 'string' ? data.allowlistPath : undefined
}

/** `workflow.importRole`'s `workflow_source_not_allowed` refusal always carries
 *  `.data.allowlistPath` (workflow-allowlist-refusal.ts) naming where to add the source. Reads
 *  it duck-typed rather than via `instanceof RuntimeRpcCallError` — a relay or environment
 *  transport can re-wrap the error and lose the class while keeping this shape. */
function allowlistPathFromError(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined
  }
  const direct = allowlistPathFromData(error.data)
  if (direct) {
    return direct
  }
  const response = error.response
  return isRecord(response) && isRecord(response.error)
    ? allowlistPathFromData(response.error.data)
    : undefined
}

/** Imports (or re-imports, to update) a role from an allowlisted repository location (FR-015a,
 *  FR-016). Refuses client-side on an obviously empty field; the host is authoritative on the
 *  allowlist and always names where to add the source on refusal. */
export default function ImportRoleDialog({
  open,
  repo,
  settings,
  initialSource,
  initialRoleName,
  onOpenChange,
  onImported
}: ImportRoleDialogProps): React.JSX.Element {
  const sourceId = useId()
  const roleNameId = useId()
  const versionId = useId()
  // Why no reset-on-`open` effect: the caller remounts this dialog with a fresh `key` each time
  // it opens (WorkflowNameDialog's own convention), so these are only ever read once per open.
  const [source, setSource] = useState(initialSource ?? '')
  const [roleName, setRoleName] = useState(initialRoleName ?? '')
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!source.trim() || !roleName.trim()) {
      setError(
        translate(
          'auto.components.workflows.roles.ImportRoleDialog.errorRequired',
          'Enter a source and a role name.'
        )
      )
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      const result = await workflowImportRole(settings, {
        repo,
        source: source.trim(),
        roleName: roleName.trim(),
        version: version.trim() || undefined
      })
      onImported(result.role)
      onOpenChange(false)
    } catch (err) {
      const allowlistPath = allowlistPathFromError(err)
      setError(
        hasRuntimeRpcErrorCode(err, 'workflow_source_not_allowed')
          ? allowlistPath
            ? translate(
                'auto.components.workflows.roles.ImportRoleDialog.errorNotAllowedWithPath',
                '"{{source}}" is not on the project allowlist. Add it to workflows.allowedSources in {{path}}.',
                { source: source.trim(), path: allowlistPath }
              )
            : translate(
                'auto.components.workflows.roles.ImportRoleDialog.errorNotAllowed',
                '"{{source}}" is not on the project allowlist.',
                { source: source.trim() }
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
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.workflows.roles.ImportRoleDialog.title',
                'Import role from repository'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.workflows.roles.ImportRoleDialog.description',
                'The source must be on the project allowlist. Re-importing the same role updates it and flags local changes since the last import.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <div className="space-y-1">
              <Label htmlFor={sourceId}>
                {translate(
                  'auto.components.workflows.roles.ImportRoleDialog.sourceLabel',
                  'Source'
                )}
              </Label>
              <Input
                id={sourceId}
                autoFocus
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={translate(
                  'auto.components.workflows.roles.ImportRoleDialog.sourcePlaceholder',
                  'https://github.com/org/repo'
                )}
                aria-invalid={error ? true : undefined}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={roleNameId}>
                {translate(
                  'auto.components.workflows.roles.ImportRoleDialog.roleNameLabel',
                  'Role name'
                )}
              </Label>
              <Input
                id={roleNameId}
                value={roleName}
                onChange={(event) => setRoleName(event.target.value)}
                aria-invalid={error ? true : undefined}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={versionId}>
                {translate(
                  'auto.components.workflows.roles.ImportRoleDialog.versionLabel',
                  'Version (optional)'
                )}
              </Label>
              <Input
                id={versionId}
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {translate('auto.components.workflows.roles.ImportRoleDialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {translate('auto.components.workflows.roles.ImportRoleDialog.submit', 'Import')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
