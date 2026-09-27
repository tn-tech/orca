import React, { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import type { Role, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import ImportRoleDialog from './ImportRoleDialog'
import RoleEditor, { type RoleEditorWorkflowContext } from './RoleEditor'

export type { RoleEditorWorkflowContext }

export type RolesPanelProps = {
  roles: Workflow['roles']
  onSetRole: (roleId: string, role: Role) => void
  onRemoveRole: (roleId: string) => void
  allowlistedSources?: readonly string[]
  repo?: string
  /** The open repo's trust host (FR-018a); forwarded to `RoleEditor`'s Trust dialog. */
  host?: string
  settings?: RuntimeWorkflowSettings
  workflow?: RoleEditorWorkflowContext
  onReloadFromDisk?: () => void | Promise<void>
}

function blankRole(id: string, name: string): Role {
  return { id, name, agent: '', systemPrompt: '', skills: [] }
}

/**
 * Workflow-level roles surface (US4 AS1): lists `definition.roles`, creates a blank role, imports
 * one from a repository, edits one with `RoleEditor`, and removes one. Shown by `NodeInspector`
 * when nothing is selected — the workflow-level counterpart to a node's own settings.
 */
export default function RolesPanel({
  roles,
  onSetRole,
  onRemoveRole,
  allowlistedSources,
  repo,
  host,
  settings,
  workflow,
  onReloadFromDisk
}: RolesPanelProps): React.JSX.Element {
  const newRoleIdId = useId()
  const newRoleNameId = useId()
  const [newRoleOpen, setNewRoleOpen] = useState(false)
  const [newRoleId, setNewRoleId] = useState('')
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleError, setNewRoleError] = useState<string | undefined>()
  const [importOpen, setImportOpen] = useState(false)
  const [editingRoleId, setEditingRoleId] = useState<string | undefined>()

  const roleList = Object.values(roles).sort((a, b) => a.name.localeCompare(b.name))
  const editingRole = editingRoleId ? roles[editingRoleId] : undefined
  const canImport = repo !== undefined && settings !== undefined

  function submitNewRole(event: React.FormEvent): void {
    event.preventDefault()
    const id = newRoleId.trim()
    const name = newRoleName.trim()
    if (!id || !name) {
      setNewRoleError(
        translate(
          'auto.components.workflows.roles.RolesPanel.newRoleErrorRequired',
          'Enter an id and a name.'
        )
      )
      return
    }
    if (roles[id]) {
      setNewRoleError(
        translate(
          'auto.components.workflows.roles.RolesPanel.newRoleErrorTaken',
          'A role with this id already exists.'
        )
      )
      return
    }
    onSetRole(id, blankRole(id, name))
    setNewRoleOpen(false)
    setNewRoleId('')
    setNewRoleName('')
    setNewRoleError(undefined)
    setEditingRoleId(id)
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto scrollbar-sleek p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {translate('auto.components.workflows.roles.RolesPanel.heading', 'Roles')}
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={translate(
                'auto.components.workflows.roles.RolesPanel.addRole',
                'Add role'
              )}
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setNewRoleOpen(true)}>
              {translate('auto.components.workflows.roles.RolesPanel.newRole', 'New role')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImportOpen(true)} disabled={!canImport}>
              {translate(
                'auto.components.workflows.roles.RolesPanel.importRole',
                'Import from repository…'
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {roleList.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.roles.RolesPanel.empty',
            'No roles yet. Create one or import from a repository.'
          )}
        </p>
      ) : (
        <ul className="space-y-1">
          {roleList.map((role) => (
            <li
              key={role.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => setEditingRoleId(role.id)}
              >
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{role.name}</span>
                {role.origin ? (
                  <Badge variant="outline" className="shrink-0">
                    {translate('auto.components.workflows.roles.RolesPanel.imported', 'Imported')}
                  </Badge>
                ) : null}
              </button>
              <span className="shrink-0 opacity-0 group-hover:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onRemoveRole(role.id)}
                  aria-label={translate(
                    'auto.components.workflows.roles.RolesPanel.removeRole',
                    'Remove role'
                  )}
                >
                  <Trash2 />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={newRoleOpen} onOpenChange={setNewRoleOpen}>
        <DialogContent className="max-w-sm">
          <form onSubmit={submitNewRole}>
            <DialogHeader>
              <DialogTitle>
                {translate('auto.components.workflows.roles.RolesPanel.newRoleTitle', 'New role')}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-4">
              <div className="space-y-1">
                <Label htmlFor={newRoleIdId}>
                  {translate('auto.components.workflows.roles.RolesPanel.newRoleIdLabel', 'Id')}
                </Label>
                <Input
                  id={newRoleIdId}
                  autoFocus
                  value={newRoleId}
                  onChange={(event) => setNewRoleId(event.target.value)}
                  aria-invalid={newRoleError ? true : undefined}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={newRoleNameId}>
                  {translate('auto.components.workflows.roles.RolesPanel.newRoleNameLabel', 'Name')}
                </Label>
                <Input
                  id={newRoleNameId}
                  value={newRoleName}
                  onChange={(event) => setNewRoleName(event.target.value)}
                  aria-invalid={newRoleError ? true : undefined}
                />
              </div>
              {newRoleError ? <p className="text-xs text-destructive">{newRoleError}</p> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setNewRoleOpen(false)}>
                {translate('auto.components.workflows.roles.RolesPanel.cancel', 'Cancel')}
              </Button>
              <Button type="submit">
                {translate('auto.components.workflows.roles.RolesPanel.create', 'Create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {repo && settings ? (
        <ImportRoleDialog
          key={importOpen ? 'open' : 'closed'}
          open={importOpen}
          repo={repo}
          settings={settings}
          refuseRoleName={(roleName) =>
            roles[roleName]
              ? translate(
                  'auto.components.workflows.roles.RolesPanel.importRoleIdTaken',
                  'A role named "{{id}}" already exists. Open it and use Re-import instead.',
                  { id: roleName }
                )
              : undefined
          }
          onOpenChange={setImportOpen}
          onImported={(result) => {
            onSetRole(result.role.id, result.role)
            setEditingRoleId(result.role.id)
          }}
        />
      ) : null}

      <Dialog
        open={editingRole !== undefined}
        onOpenChange={(open) => !open && setEditingRoleId(undefined)}
      >
        <DialogContent className="max-w-lg">
          {editingRole ? (
            <>
              <DialogHeader>
                <DialogTitle>{editingRole.name}</DialogTitle>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto scrollbar-sleek">
                <RoleEditor
                  role={editingRole}
                  onChange={(role) => onSetRole(editingRole.id, role)}
                  roles={roles}
                  allowlistedSources={allowlistedSources}
                  repo={repo}
                  host={host}
                  settings={settings}
                  workflow={workflow}
                  onReloadFromDisk={onReloadFromDisk}
                />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
