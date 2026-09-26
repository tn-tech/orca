// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Role, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import RoleEditor, { type RoleEditorProps } from './RoleEditor'

afterEach(() => {
  cleanup()
})

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
})
