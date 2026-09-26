// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Role, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import RolesPanel, { type RolesPanelProps } from './RolesPanel'

const { workflowImportRoleMock } = vi.hoisted(() => ({ workflowImportRoleMock: vi.fn() }))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowImportRole: workflowImportRoleMock
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  workflowImportRoleMock.mockReset()
})

function role(patch: Partial<Role> = {}): Role {
  return {
    id: 'reviewer',
    name: 'Reviewer',
    agent: 'claude',
    systemPrompt: 'Review the change.',
    skills: [],
    ...patch
  }
}

function renderPanel(props: Partial<RolesPanelProps> = {}): void {
  render(
    <TooltipProvider>
      <RolesPanel roles={{}} onSetRole={vi.fn()} onRemoveRole={vi.fn()} {...props} />
    </TooltipProvider>
  )
}

/** RolesPanel is a controlled component (like AgentNodeFields): `roles` is only ever the prop the
 *  caller passes. This wraps it with real state, the way `session.editor.dispatch` would, so a
 *  test can see the follow-on effect of `onSetRole` (e.g. the newly created role becoming
 *  editable) instead of only the call itself. */
function StatefulPanel(props: Omit<RolesPanelProps, 'roles' | 'onSetRole' | 'onRemoveRole'>) {
  const [roles, setRoles] = useState<Workflow['roles']>({})
  return (
    <RolesPanel
      roles={roles}
      onSetRole={(roleId, role) => setRoles((prev) => ({ ...prev, [roleId]: role }))}
      onRemoveRole={(roleId) =>
        setRoles((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== roleId)))
      }
      {...props}
    />
  )
}

describe('RolesPanel (US4 AS1)', () => {
  it('shows an empty state with no roles yet', () => {
    renderPanel()
    expect(
      screen.getByText('No roles yet. Create one or import from a repository.')
    ).toBeInTheDocument()
  })

  it('lists every role by name, flagging imported ones', () => {
    const roles: Workflow['roles'] = {
      reviewer: role(),
      implementer: role({
        id: 'implementer',
        name: 'Implementer',
        origin: {
          source: 'https://example.com/repo',
          version: 'v1',
          importedAt: '2026-01-01',
          localModified: false
        }
      })
    }
    renderPanel({ roles })

    expect(screen.getByText('Reviewer')).toBeInTheDocument()
    expect(screen.getByText('Implementer')).toBeInTheDocument()
    expect(screen.getByText('Imported')).toBeInTheDocument()
  })

  it('creates a new role and opens it for editing', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <StatefulPanel />
      </TooltipProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Add role' }))
    await user.click(screen.getByRole('menuitem', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'dev' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    // Immediately opens the new role for editing.
    expect(screen.getByRole('heading', { name: 'Dev' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Dev')
  })

  it('refuses a new role id that already exists', async () => {
    const user = userEvent.setup()
    renderPanel({ roles: { dev: role({ id: 'dev', name: 'Dev' }) } })

    await user.click(screen.getByRole('button', { name: 'Add role' }))
    await user.click(screen.getByRole('menuitem', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'dev' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dev 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByText('A role with this id already exists.')).toBeInTheDocument()
  })

  it('removes a role', () => {
    const onRemoveRole = vi.fn()
    renderPanel({ roles: { reviewer: role() }, onRemoveRole })

    fireEvent.click(screen.getByRole('button', { name: 'Remove role' }))

    expect(onRemoveRole).toHaveBeenCalledWith('reviewer')
  })

  it('opens an existing role in RoleEditor and reports edits through onSetRole', () => {
    const onSetRole = vi.fn()
    renderPanel({ roles: { reviewer: role() }, onSetRole })

    fireEvent.click(screen.getByText('Reviewer'))
    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Be terse.' } })

    expect(onSetRole).toHaveBeenCalledWith(
      'reviewer',
      expect.objectContaining({ systemPrompt: 'Be terse.' })
    )
  })

  it('hides "Import from repository…" when repo/settings are not provided', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Add role' }))

    expect(screen.getByRole('menuitem', { name: 'Import from repository…' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('imports a role from a repository and opens it for editing', async () => {
    const user = userEvent.setup()
    workflowImportRoleMock.mockResolvedValue({
      role: role({ id: 'imported-role', name: 'Imported Role' })
    })
    render(
      <TooltipProvider>
        <StatefulPanel repo="repo-1" settings={{ activeRuntimeEnvironmentId: null }} />
      </TooltipProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Add role' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import from repository…' }))
    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'https://example.com/repo' }
    })
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'imported-role' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    await vi.waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Imported Role' })).toBeInTheDocument()
    )
  })

  it('refuses to replace an existing role when the imported id collides, instead of silently overwriting it', async () => {
    const user = userEvent.setup()
    workflowImportRoleMock.mockResolvedValue({
      role: role({ name: 'Upstream Reviewer', systemPrompt: 'Upstream prompt.' })
    })
    const onSetRole = vi.fn()
    renderPanel({
      roles: { reviewer: role({ systemPrompt: 'My locally edited prompt.' }) },
      onSetRole,
      repo: 'repo-1',
      settings: { activeRuntimeEnvironmentId: null }
    })

    await user.click(screen.getByRole('button', { name: 'Add role' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import from repository…' }))
    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'https://example.com/repo' }
    })
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'reviewer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    expect(
      screen.getByText('A role named "reviewer" already exists. Open it and use Re-import instead.')
    ).toBeInTheDocument()
    expect(workflowImportRoleMock).not.toHaveBeenCalled()
    expect(onSetRole).not.toHaveBeenCalled()
  })
})
