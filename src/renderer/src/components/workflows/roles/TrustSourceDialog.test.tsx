// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrustSourceDialog from './TrustSourceDialog'

const { workflowTrustDecideMock } = vi.hoisted(() => ({ workflowTrustDecideMock: vi.fn() }))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowTrustDecide: workflowTrustDecideMock
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  workflowTrustDecideMock.mockReset()
})

const settings = { activeRuntimeEnvironmentId: null }

describe('TrustSourceDialog (FR-018a)', () => {
  it('shows the source, the skills it provides and the agents affected', () => {
    render(
      <TrustSourceDialog
        open
        settings={settings}
        source="speckit"
        skills={['speckit-plan', 'speckit-tasks']}
        agents={['claude', 'codex']}
        onOpenChange={vi.fn()}
      />
    )

    expect(screen.getByText('speckit')).toBeInTheDocument()
    expect(screen.getByText('speckit-plan')).toBeInTheDocument()
    expect(screen.getByText('speckit-tasks')).toBeInTheDocument()
    expect(screen.getByText('claude, codex')).toBeInTheDocument()
  })

  it('records a trusted decision and closes', async () => {
    workflowTrustDecideMock.mockResolvedValue({})
    const onDecided = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <TrustSourceDialog
        open
        settings={settings}
        source="speckit"
        skills={[]}
        agents={[]}
        onOpenChange={onOpenChange}
        onDecided={onDecided}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Trust' }))

    await waitFor(() =>
      expect(workflowTrustDecideMock).toHaveBeenCalledWith(settings, {
        source: 'speckit',
        decision: 'trusted'
      })
    )
    expect(onDecided).toHaveBeenCalledWith('trusted')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('records a refused decision and fails the node without installing (no separate call)', async () => {
    workflowTrustDecideMock.mockResolvedValue({})
    const onDecided = vi.fn()
    render(
      <TrustSourceDialog
        open
        settings={settings}
        source="speckit"
        skills={[]}
        agents={[]}
        onOpenChange={vi.fn()}
        onDecided={onDecided}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refuse' }))

    await waitFor(() =>
      expect(workflowTrustDecideMock).toHaveBeenCalledWith(settings, {
        source: 'speckit',
        decision: 'refused'
      })
    )
    expect(onDecided).toHaveBeenCalledWith('refused')
  })

  it('passes the given host through to the decision, and shows it when not local', async () => {
    workflowTrustDecideMock.mockResolvedValue({})
    render(
      <TrustSourceDialog
        open
        settings={settings}
        source="speckit"
        skills={[]}
        agents={[]}
        host="ssh:devbox"
        onOpenChange={vi.fn()}
      />
    )

    expect(screen.getByText('ssh:devbox')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trust' }))

    await waitFor(() =>
      expect(workflowTrustDecideMock).toHaveBeenCalledWith(settings, {
        source: 'speckit',
        decision: 'trusted',
        host: 'ssh:devbox'
      })
    )
  })

  it('omits the host from the decision, and the host row, for a local (or unspecified) host', async () => {
    workflowTrustDecideMock.mockResolvedValue({})
    render(
      <TrustSourceDialog
        open
        settings={settings}
        source="speckit"
        skills={[]}
        agents={[]}
        host="local"
        onOpenChange={vi.fn()}
      />
    )

    expect(screen.queryByText('local')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trust' }))

    await waitFor(() =>
      expect(workflowTrustDecideMock).toHaveBeenCalledWith(settings, {
        source: 'speckit',
        decision: 'trusted'
      })
    )
  })

  it('shows the RPC error inline and does not close on failure', async () => {
    workflowTrustDecideMock.mockRejectedValue(new Error('runtime_unavailable'))
    const onOpenChange = vi.fn()
    render(
      <TrustSourceDialog
        open
        settings={settings}
        source="speckit"
        skills={[]}
        agents={[]}
        onOpenChange={onOpenChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Trust' }))

    await waitFor(() => expect(screen.getByText('runtime_unavailable')).toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
