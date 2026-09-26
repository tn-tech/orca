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
import {
  workflowImportRole,
  type RuntimeWorkflowSettings,
  type WorkflowImportRoleResult
} from '@/runtime/runtime-workflow-client'
import type { WorkflowRunSource } from '../../../../../shared/workflows/workflow-run-types'

/** Present for a re-import (FR-016): writes straight into the saved workflow file instead of
 *  only fetching and returning the role. `expectedRevision` should be the draft's current saved
 *  revision — the caller is responsible for only offering this once the draft is clean, since the
 *  engine's hash check runs against what's actually on disk. */
export type ImportRoleDialogTarget = {
  workflow: string
  workflowSource?: WorkflowRunSource
  expectedRevision?: string
}

export type ImportRoleDialogProps = {
  open: boolean
  repo: string
  settings: RuntimeWorkflowSettings
  initialSource?: string
  /** Fixed for a re-import: the role's own id (its source repo's file stem), never its display
   *  `name` — re-import must target the exact same role slot, not whatever the user might type. */
  fixedRoleName?: string
  target?: ImportRoleDialogTarget
  /** Client-side pre-check, run before the RPC (no `target`, plain fetch, only): the fetched
   *  role's id equals `roleName` exactly (workflow-role-import.ts), so a caller inserting it into
   *  a draft under a fresh id can catch a collision with an existing role here and refuse with a
   *  clear message, instead of silently overwriting a role the RPC has no way to know about. */
  refuseRoleName?: (roleName: string) => string | undefined
  onOpenChange: (open: boolean) => void
  onImported: (result: WorkflowImportRoleResult) => void
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

/**
 * Imports a role from an allowlisted repository location (FR-015a). Without `target`, only
 * fetches and returns the role — the caller inserts it into its own draft. With `target`, writes
 * straight into that saved workflow file (FR-016): the result carries a `revision` on success, or
 * `availableVersion` (no `revision`) when a locally modified copy was kept instead and the
 * upstream version wasn't applied — `RoleEditor` handles that outcome, not this dialog.
 */
export default function ImportRoleDialog({
  open,
  repo,
  settings,
  initialSource,
  fixedRoleName,
  target,
  refuseRoleName,
  onOpenChange,
  onImported
}: ImportRoleDialogProps): React.JSX.Element {
  const sourceId = useId()
  const roleNameId = useId()
  const versionId = useId()
  // Why no reset-on-`open` effect: the caller remounts this dialog with a fresh `key` each time
  // it opens (WorkflowNameDialog's own convention), so these are only ever read once per open.
  const [source, setSource] = useState(initialSource ?? '')
  const [roleName, setRoleName] = useState(fixedRoleName ?? '')
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const effectiveRoleName = fixedRoleName ?? roleName
    if (!source.trim() || !effectiveRoleName.trim()) {
      setError(
        translate(
          'auto.components.workflows.roles.ImportRoleDialog.errorRequired',
          'Enter a source and a role name.'
        )
      )
      return
    }
    const refusal = refuseRoleName?.(effectiveRoleName.trim())
    if (refusal) {
      setError(refusal)
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      const result = await workflowImportRole(settings, {
        repo,
        source: source.trim(),
        roleName: effectiveRoleName.trim(),
        version: version.trim() || undefined,
        ...(target
          ? {
              workflow: target.workflow,
              workflowSource: target.workflowSource,
              expectedRevision: target.expectedRevision
            }
          : {})
      })
      onImported(result)
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
              {target
                ? translate(
                    'auto.components.workflows.roles.ImportRoleDialog.reimportTitle',
                    'Re-import role from repository'
                  )
                : translate(
                    'auto.components.workflows.roles.ImportRoleDialog.title',
                    'Import role from repository'
                  )}
            </DialogTitle>
            <DialogDescription>
              {target
                ? translate(
                    'auto.components.workflows.roles.ImportRoleDialog.reimportDescription',
                    "The source must be on the project allowlist. If your local edits differ from what was last imported, they're kept as-is and you'll be offered an explicit choice to overwrite them with the upstream version instead."
                  )
                : translate(
                    'auto.components.workflows.roles.ImportRoleDialog.description',
                    'The source must be on the project allowlist.'
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
                value={fixedRoleName ?? roleName}
                onChange={(event) => setRoleName(event.target.value)}
                disabled={fixedRoleName !== undefined}
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
