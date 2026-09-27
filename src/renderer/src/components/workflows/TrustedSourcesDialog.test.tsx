// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrustedSourcesDialog from './TrustedSourcesDialog'

const { workflowTrustListMock, workflowTrustDecideMock } = vi.hoisted(() => ({
  workflowTrustListMock: vi.fn(),
  workflowTrustDecideMock: vi.fn()
}))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowTrustList: workflowTrustListMock,
  workflowTrustDecide: workflowTrustDecideMock
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  workflowTrustListMock.mockReset()
  workflowTrustDecideMock.mockReset()
})

const settings = { activeRuntimeEnvironmentId: null }

describe('TrustedSourcesDialog (FR-018a revocability)', () => {
  it('lists decisions per source and host, with Revoke only on a trusted one', async () => {
    workflowTrustListMock.mockResolvedValue({
      decisions: [
        {
          source: 'speckit',
          host: 'local',
          decision: 'trusted',
          decidedBy: 'user',
          decidedAt: 't1'
        },
        {
          source: 'acme-decks',
          host: 'ssh:devbox',
          decision: 'refused',
          decidedBy: 'user',
          decidedAt: 't2'
        }
      ]
    })
    render(<TrustedSourcesDialog open settings={settings} onOpenChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('speckit')).toBeInTheDocument())
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('acme-decks')).toBeInTheDocument()
    expect(screen.getByText('ssh:devbox')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
  })

  it('shows an empty state with no decisions', async () => {
    workflowTrustListMock.mockResolvedValue({ decisions: [] })
    render(<TrustedSourcesDialog open settings={settings} onOpenChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('No trust decisions yet.')).toBeInTheDocument())
  })

  it('revoking a trusted source decides it refused, scoped to its own host', async () => {
    workflowTrustListMock.mockResolvedValue({
      decisions: [
        {
          source: 'acme-decks',
          host: 'ssh:devbox',
          decision: 'trusted',
          decidedBy: 'user',
          decidedAt: 't1'
        }
      ]
    })
    workflowTrustDecideMock.mockResolvedValue({})
    render(<TrustedSourcesDialog open settings={settings} onOpenChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('acme-decks')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(workflowTrustDecideMock).toHaveBeenCalledWith(settings, {
        source: 'acme-decks',
        decision: 'refused',
        host: 'ssh:devbox'
      })
    )
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
  })

  it('omits the host param when revoking a local decision', async () => {
    workflowTrustListMock.mockResolvedValue({
      decisions: [
        {
          source: 'speckit',
          host: 'local',
          decision: 'trusted',
          decidedBy: 'user',
          decidedAt: 't1'
        }
      ]
    })
    workflowTrustDecideMock.mockResolvedValue({})
    render(<TrustedSourcesDialog open settings={settings} onOpenChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('speckit')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(workflowTrustDecideMock).toHaveBeenCalledWith(settings, {
        source: 'speckit',
        decision: 'refused'
      })
    )
  })

  it('shows the RPC error inline when the list fails to load', async () => {
    workflowTrustListMock.mockRejectedValue(new Error('runtime_unavailable'))
    render(<TrustedSourcesDialog open settings={settings} onOpenChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('runtime_unavailable')).toBeInTheDocument())
  })

  it('does not fetch while closed', () => {
    render(<TrustedSourcesDialog open={false} settings={settings} onOpenChange={vi.fn()} />)

    expect(workflowTrustListMock).not.toHaveBeenCalled()
  })
})
