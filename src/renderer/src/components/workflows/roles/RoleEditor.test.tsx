// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Role, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import RoleEditor, { type RoleEditorProps, type RoleEditorWorkflowContext } from './RoleEditor'

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

const settings = { activeRuntimeEnvironmentId: null }

function role(patch: Partial<Role> = {}): Role {
  return {
    id: 'reviewer',
    name: 'Reviewer',
    agent: 'claude',
    systemPrompt: 'Review the change for correctness.',
    skills: [],
    ...patch
  }
}

function importedRole(patch: Partial<Role> = {}): Role {
  return role({
    origin: {
      source: 'https://example.com/repo',
      version: 'v1',
      importedAt: '2026-01-01',
      localModified: false
    },
    ...patch
  })
}

function cleanWorkflow(patch: Partial<RoleEditorWorkflowContext> = {}): RoleEditorWorkflowContext {
  return { name: 'demo', source: 'project', revision: 'rev-1', dirty: false, ...patch }
}

function renderEditor(props: Partial<RoleEditorProps> & { role: Role }): void {
  render(
    <TooltipProvider>
      <RoleEditor onChange={vi.fn()} {...props} />
    </TooltipProvider>
  )
}

describe('RoleEditor (FR-015, FR-016)', () => {
  it('renders the role name, agent picker and system prompt', () => {
    renderEditor({ role: role() })

    expect(screen.getByLabelText('Name')).toHaveValue('Reviewer')
    expect(screen.getByLabelText('System prompt')).toHaveValue('Review the change for correctness.')
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
  })

  it('edits the name', () => {
    const onChange = vi.fn()
    renderEditor({ role: role(), onChange })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Senior Reviewer' } })

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Senior Reviewer' }))
  })

  it('edits the system prompt', () => {
    const onChange = vi.fn()
    renderEditor({ role: role(), onChange })

    fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Be terse.' } })

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ systemPrompt: 'Be terse.' })
    )
  })

  it('hides the import action without repo/settings', () => {
    renderEditor({ role: role() })
    expect(
      screen.queryByRole('button', { name: 'Import from repository…' })
    ).not.toBeInTheDocument()
  })

  it('shows the import action once repo/settings are provided', () => {
    renderEditor({
      role: role(),
      repo: 'repo-1',
      settings: { activeRuntimeEnvironmentId: null }
    })
    expect(screen.getByRole('button', { name: 'Import from repository…' })).toBeInTheDocument()
  })

  it('shows origin and a "Locally modified" badge when the role has drifted from its import', () => {
    renderEditor({
      role: role({
        origin: {
          source: 'https://example.com/repo',
          version: 'v1',
          importedAt: '2026-01-01',
          localModified: true
        }
      })
    })

    expect(
      screen.getByText('Imported from https://example.com/repo @ v1 on 2026-01-01.')
    ).toBeInTheDocument()
    expect(screen.getByText('Locally modified')).toBeInTheDocument()
  })

  it('opens a trust dialog scoped to the source across every role using it', () => {
    const roles: Workflow['roles'] = {
      reviewer: role({
        skills: [
          { name: 'speckit-plan', source: { kind: 'plugin', plugin: 'speckit' }, required: true }
        ]
      }),
      implementer: {
        id: 'implementer',
        name: 'Implementer',
        agent: 'codex',
        systemPrompt: 'Implement it.',
        skills: [
          { name: 'speckit-tasks', source: { kind: 'plugin', plugin: 'speckit' }, required: true }
        ]
      }
    }
    renderEditor({ role: roles.reviewer, roles })

    fireEvent.click(screen.getByRole('button', { name: 'Trust…' }))

    expect(screen.getAllByText('speckit').length).toBeGreaterThan(0)
    expect(screen.getByText('speckit-plan')).toBeInTheDocument()
    expect(screen.getByText('speckit-tasks')).toBeInTheDocument()
    expect(screen.getByText('claude, codex')).toBeInTheDocument()
  })

  describe('re-import (FR-016)', () => {
    it('shows Re-import (not "Import from repository…") for an already-imported role', () => {
      renderEditor({ role: importedRole(), repo: 'repo-1', settings, workflow: cleanWorkflow() })

      expect(screen.getByRole('button', { name: 'Re-import…' })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Import from repository…' })
      ).not.toBeInTheDocument()
    })

    it('disables Re-import with an explanation while the draft has unsaved edits', () => {
      renderEditor({
        role: importedRole(),
        repo: 'repo-1',
        settings,
        workflow: cleanWorkflow({ dirty: true })
      })

      const button = screen.getByRole('button', { name: 'Re-import…' })
      expect(button).toBeDisabled()
      expect(
        screen.getByText(
          'Save your changes before re-importing — the check runs against the saved file.'
        )
      ).toBeInTheDocument()
    })

    it('disables Re-import with an explanation before the workflow has ever been saved', () => {
      renderEditor({
        role: importedRole(),
        repo: 'repo-1',
        settings,
        workflow: cleanWorkflow({ revision: null })
      })

      expect(screen.getByRole('button', { name: 'Re-import…' })).toBeDisabled()
      expect(
        screen.getByText('Save the workflow at least once before re-importing.')
      ).toBeInTheDocument()
    })

    it('hides re-import entirely with no workflow context', () => {
      renderEditor({ role: importedRole(), repo: 'repo-1', settings })
      expect(screen.queryByRole('button', { name: 'Re-import…' })).not.toBeInTheDocument()
    })

    it('re-imports using the role id (not its display name) as the fixed role name, targeting the saved workflow', async () => {
      workflowImportRoleMock.mockResolvedValue({ role: importedRole(), revision: 'rev-2' })
      const onReloadFromDisk = vi.fn()
      renderEditor({
        role: importedRole({ name: 'Reviewer (renamed)' }),
        repo: 'repo-1',
        settings,
        workflow: cleanWorkflow(),
        onReloadFromDisk
      })

      fireEvent.click(screen.getByRole('button', { name: 'Re-import…' }))
      const dialogRoleName = screen.getByLabelText('Role name')
      expect(dialogRoleName).toHaveValue('reviewer')
      expect(dialogRoleName).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'Import' }))

      await waitFor(() =>
        expect(workflowImportRoleMock).toHaveBeenCalledWith(settings, {
          repo: 'repo-1',
          source: 'https://example.com/repo',
          roleName: 'reviewer',
          version: undefined,
          workflow: 'demo',
          workflowSource: 'project',
          expectedRevision: 'rev-1'
        })
      )
      await waitFor(() => expect(onReloadFromDisk).toHaveBeenCalled())
    })

    it('offers an explicit overwrite when the engine kept local edits and reports an available upstream version', async () => {
      workflowImportRoleMock.mockResolvedValue({ role: importedRole(), availableVersion: 'v2' })
      const onReloadFromDisk = vi.fn()
      renderEditor({
        role: importedRole(),
        repo: 'repo-1',
        settings,
        workflow: cleanWorkflow(),
        onReloadFromDisk
      })

      fireEvent.click(screen.getByRole('button', { name: 'Re-import…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Import' }))

      await waitFor(() =>
        expect(
          screen.getByText(
            'Your local changes were kept. Version v2 is available upstream but was not applied.'
          )
        ).toBeInTheDocument()
      )
      expect(onReloadFromDisk).not.toHaveBeenCalled()

      workflowImportRoleMock.mockResolvedValue({ role: importedRole(), revision: 'rev-2' })
      fireEvent.click(screen.getByRole('button', { name: 'Overwrite local changes' }))

      await waitFor(() =>
        expect(workflowImportRoleMock).toHaveBeenLastCalledWith(settings, {
          repo: 'repo-1',
          source: 'https://example.com/repo',
          roleName: 'reviewer',
          workflow: 'demo',
          workflowSource: 'project',
          expectedRevision: 'rev-1',
          overwriteLocal: true
        })
      )
      await waitFor(() => expect(onReloadFromDisk).toHaveBeenCalled())
    })
  })
})
