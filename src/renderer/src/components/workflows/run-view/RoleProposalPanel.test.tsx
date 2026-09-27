// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import type { RoleProposalView } from '../../../../../shared/workflows/workflow-run-types'

const { workflowProposalAcceptMock, workflowProposalExportMock } = vi.hoisted(() => ({
  workflowProposalAcceptMock: vi.fn(),
  workflowProposalExportMock: vi.fn()
}))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowProposalAccept: workflowProposalAcceptMock,
  workflowProposalExport: workflowProposalExportMock
}))

import RoleProposalPanel from './RoleProposalPanel'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  workflowProposalAcceptMock.mockReset()
  workflowProposalExportMock.mockReset()
})

const settings = { activeRuntimeEnvironmentId: null }

function role(patch: Partial<Role> = {}): Role {
  return {
    id: 'reviewer',
    name: 'Reviewer',
    agent: 'claude',
    systemPrompt: 'Review the change carefully.',
    skills: [],
    ...patch
  }
}

function proposal(patch: Partial<RoleProposalView> = {}): RoleProposalView {
  return {
    id: 'proposal-1',
    runId: 'run-1',
    attemptId: 'attempt-1',
    roleId: 'reviewer',
    change: { systemPrompt: 'Review the change carefully, and check test coverage.' },
    evidence: 'Three runs missed test coverage gaps.',
    state: 'proposed',
    ...patch
  }
}

function roles(...list: Role[]): Workflow['roles'] {
  return Object.fromEntries(list.map((r) => [r.id, r]))
}

describe('RoleProposalPanel (US7)', () => {
  it('renders nothing when there are no proposals', () => {
    const { container } = render(
      <RoleProposalPanel runId="run-1" proposals={[]} roles={{}} settings={settings} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the role, evidence, and state for each proposal', () => {
    render(
      <RoleProposalPanel
        runId="run-1"
        proposals={[proposal()]}
        roles={roles(role())}
        settings={settings}
      />
    )

    expect(screen.getByText('Reviewer')).toBeInTheDocument()
    expect(screen.getByText('Three runs missed test coverage gaps.')).toBeInTheDocument()
    expect(screen.getByText('Proposed')).toBeInTheDocument()
  })

  it('shows a collapsed diff of the proposed systemPrompt change, expandable on click', () => {
    render(
      <RoleProposalPanel
        runId="run-1"
        proposals={[proposal()]}
        roles={roles(role())}
        settings={settings}
      />
    )

    expect(screen.getByText('System prompt')).toBeInTheDocument()
    expect(screen.queryByText(/check test coverage/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /System prompt/ }))

    expect(screen.getByText(/check test coverage/)).toBeInTheDocument()
  })

  it('accepts a proposal via workflow.proposal.accept and notifies the caller the file changed', async () => {
    workflowProposalAcceptMock.mockResolvedValue({ revision: 'rev-2' })
    const onWorkflowFileChanged = vi.fn()
    render(
      <RoleProposalPanel
        runId="run-1"
        proposals={[proposal()]}
        roles={roles(role())}
        settings={settings}
        onWorkflowFileChanged={onWorkflowFileChanged}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() =>
      expect(workflowProposalAcceptMock).toHaveBeenCalledWith(settings, {
        runId: 'run-1',
        proposalId: 'proposal-1'
      })
    )
    await waitFor(() => expect(onWorkflowFileChanged).toHaveBeenCalled())
  })

  it('disables Accept once the proposal is already accepted', () => {
    render(
      <RoleProposalPanel
        runId="run-1"
        proposals={[proposal({ state: 'accepted' })]}
        roles={roles(role())}
        settings={settings}
      />
    )

    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByText('Accepted')).toBeInTheDocument()
  })

  it('explains a file conflict and offers reload instead of the raw error (like the editor file-conflict flow)', async () => {
    workflowProposalAcceptMock.mockRejectedValue(new Error('workflow_file_conflict'))
    const onReloadFromDisk = vi.fn()
    render(
      <RoleProposalPanel
        runId="run-1"
        proposals={[proposal()]}
        roles={roles(role())}
        settings={settings}
        onReloadFromDisk={onReloadFromDisk}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(screen.getByText(/changed on disk/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Reload workflow' }))
    expect(onReloadFromDisk).toHaveBeenCalled()
  })

  it('shows the allowlist location on workflow_source_not_allowed (like ImportRoleDialog)', async () => {
    workflowProposalAcceptMock.mockRejectedValue({
      code: 'workflow_source_not_allowed',
      data: { allowlistPath: '.orca/workflows.allowlist.json' }
    })
    render(
      <RoleProposalPanel
        runId="run-1"
        proposals={[proposal()]}
        roles={roles(role())}
        settings={settings}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() =>
      expect(screen.getByText(/.orca\/workflows.allowlist.json/)).toBeInTheDocument()
    )
  })

  it('falls back to the shorter allowlist copy when the refusal carries no path', async () => {
    workflowProposalAcceptMock.mockRejectedValue({ code: 'workflow_source_not_allowed' })
    render(
      <RoleProposalPanel
        runId="run-1"
        proposals={[proposal()]}
        roles={roles(role())}
        settings={settings}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() =>
      expect(
        screen.getByText("The role's source is not on the project allowlist.")
      ).toBeInTheDocument()
    )
  })

  it('shows friendly copy for method_not_found on Accept on an old host', async () => {
    workflowProposalAcceptMock.mockRejectedValue(new Error('method_not_found'))
    render(
      <RoleProposalPanel
        runId="run-1"
        proposals={[proposal()]}
        roles={roles(role())}
        settings={settings}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() =>
      expect(screen.getByText("This isn't available on this host yet.")).toBeInTheDocument()
    )
  })

  it('disables Export with an explanation for a role that was never imported', () => {
    render(
      <RoleProposalPanel
        runId="run-1"
        proposals={[proposal()]}
        roles={roles(role())}
        settings={settings}
      />
    )

    const exportButton = screen.getByRole('button', { name: 'Export' })
    expect(exportButton).toBeDisabled()
    expect(exportButton).toHaveAttribute(
      'title',
      'Only a role imported from a repository can be exported.'
    )
  })

  it('exports an imported role and shows the export path', async () => {
    workflowProposalExportMock.mockResolvedValue({
      exportPath: '.orca/workflow-runs/run-1/proposals/reviewer.patch'
    })
    render(
      <RoleProposalPanel
        runId="run-1"
        proposals={[proposal()]}
        roles={roles(
          role({
            origin: {
              source: 'org/roles-repo',
              version: 'abc123',
              importedAt: '2026-01-01T00:00:00.000Z',
              localModified: false
            }
          })
        )}
        settings={settings}
      />
    )

    const exportButton = screen.getByRole('button', { name: 'Export' })
    expect(exportButton).toBeEnabled()
    fireEvent.click(exportButton)

    await waitFor(() =>
      expect(
        screen.getByText(/.orca\/workflow-runs\/run-1\/proposals\/reviewer.patch/)
      ).toBeInTheDocument()
    )
    expect(workflowProposalExportMock).toHaveBeenCalledWith(settings, {
      runId: 'run-1',
      proposalId: 'proposal-1'
    })
  })
})
