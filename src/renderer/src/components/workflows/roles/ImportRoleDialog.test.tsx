// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportRoleDialog from './ImportRoleDialog'

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

function role() {
  return {
    id: 'reviewer',
    name: 'Reviewer',
    agent: 'claude',
    systemPrompt: 'Review the change.',
    skills: [],
    origin: {
      source: 'https://example.com/repo',
      version: 'v1',
      importedAt: '2026-01-01',
      localModified: false
    }
  }
}

describe('ImportRoleDialog (FR-015a, FR-016)', () => {
  it('imports a role and reports it to the caller', async () => {
    workflowImportRoleMock.mockResolvedValue({ role: role() })
    const onImported = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ImportRoleDialog
        open
        repo="repo-1"
        settings={settings}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />
    )

    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'https://example.com/repo' }
    })
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'reviewer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(role()))
    expect(workflowImportRoleMock).toHaveBeenCalledWith(settings, {
      repo: 'repo-1',
      source: 'https://example.com/repo',
      roleName: 'reviewer',
      version: undefined
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('refuses submission with a required-fields message when either field is blank', () => {
    render(
      <ImportRoleDialog
        open
        repo="repo-1"
        settings={settings}
        onOpenChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    expect(screen.getByText('Enter a source and a role name.')).toBeInTheDocument()
    expect(workflowImportRoleMock).not.toHaveBeenCalled()
  })

  it('names the allowlist location from the error data on workflow_source_not_allowed', async () => {
    workflowImportRoleMock.mockRejectedValue(
      Object.assign(new Error('workflow_source_not_allowed'), {
        name: 'RuntimeRpcCallError',
        code: 'workflow_source_not_allowed',
        response: {
          id: 'req-1',
          ok: false,
          error: {
            code: 'workflow_source_not_allowed',
            message: 'nope',
            data: { allowlistPath: 'orca.yaml' }
          }
        }
      })
    )
    render(
      <ImportRoleDialog
        open
        repo="repo-1"
        settings={settings}
        onOpenChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'https://example.com/not-allowlisted' }
    })
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'reviewer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() =>
      expect(
        screen.getByText(
          '"https://example.com/not-allowlisted" is not on the project allowlist. Add it to workflows.allowedSources in orca.yaml.'
        )
      ).toBeInTheDocument()
    )
  })
})
