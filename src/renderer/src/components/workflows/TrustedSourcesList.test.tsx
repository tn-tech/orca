// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrustedSourcesList from './TrustedSourcesList'

const { workflowTrustListMock, workflowTrustDecideMock, workflowTrustRevokeMock } = vi.hoisted(
  () => ({
    workflowTrustListMock: vi.fn(),
    workflowTrustDecideMock: vi.fn(),
    workflowTrustRevokeMock: vi.fn()
  })
)

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowTrustList: workflowTrustListMock,
  workflowTrustDecide: workflowTrustDecideMock,
  workflowTrustRevoke: workflowTrustRevokeMock
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  workflowTrustListMock.mockReset()
  workflowTrustDecideMock.mockReset()
  workflowTrustRevokeMock.mockReset()
})

const settings = { activeRuntimeEnvironmentId: null }

function decidedAtLabel(iso: string): string {
  return new Date(iso).toLocaleString()
}

describe('TrustedSourcesList (FR-018a revocability)', () => {
  it('lists decisions per source and host, formatted decidedAt, Revoke only on trusted rows', async () => {
    workflowTrustListMock.mockResolvedValue({
      decisions: [
        {
          source: 'speckit',
          host: 'local',
          decision: 'trusted',
          decidedBy: 'user',
          decidedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          source: 'acme-decks',
          host: 'ssh:devbox',
          decision: 'refused',
          decidedBy: 'user',
          decidedAt: '2026-02-02T00:00:00.000Z'
        }
      ]
    })
    render(<TrustedSourcesList settings={settings} />)

    await waitFor(() => expect(screen.getByText('speckit')).toBeInTheDocument())
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('acme-decks')).toBeInTheDocument()
    expect(screen.getByText('ssh:devbox')).toBeInTheDocument()
    expect(
      screen.getByText(`Trusted ${decidedAtLabel('2026-01-01T00:00:00.000Z')}`)
    ).toBeInTheDocument()
    expect(
      screen.getByText(`Refused ${decidedAtLabel('2026-02-02T00:00:00.000Z')}`)
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Trust' })).toHaveLength(1)
  })

  it('shows an empty state with no decisions', async () => {
    workflowTrustListMock.mockResolvedValue({ decisions: [] })
    render(<TrustedSourcesList settings={settings} />)

    await waitFor(() => expect(screen.getByText('No trust decisions yet.')).toBeInTheDocument())
  })

  it('revoking a trusted source forgets it (removed from the list), scoped to its own host', async () => {
    workflowTrustListMock.mockResolvedValue({
      decisions: [
        {
          source: 'acme-decks',
          host: 'ssh:devbox',
          decision: 'trusted',
          decidedBy: 'user',
          decidedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
    workflowTrustRevokeMock.mockResolvedValue({})
    render(<TrustedSourcesList settings={settings} />)

    await waitFor(() => expect(screen.getByText('acme-decks')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(workflowTrustRevokeMock).toHaveBeenCalledWith(settings, {
        source: 'acme-decks',
        host: 'ssh:devbox'
      })
    )
    await waitFor(() => expect(screen.queryByText('acme-decks')).not.toBeInTheDocument())
    expect(screen.getByText('No trust decisions yet.')).toBeInTheDocument()
  })

  it('omits the host param when revoking a local decision', async () => {
    workflowTrustListMock.mockResolvedValue({
      decisions: [
        {
          source: 'speckit',
          host: 'local',
          decision: 'trusted',
          decidedBy: 'user',
          decidedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
    workflowTrustRevokeMock.mockResolvedValue({})
    render(<TrustedSourcesList settings={settings} />)

    await waitFor(() => expect(screen.getByText('speckit')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(workflowTrustRevokeMock).toHaveBeenCalledWith(settings, { source: 'speckit' })
    )
  })

  it('trusting a refused source records it trusted and flips the row action to Revoke', async () => {
    workflowTrustListMock.mockResolvedValue({
      decisions: [
        {
          source: 'acme-decks',
          host: 'ssh:devbox',
          decision: 'refused',
          decidedBy: 'user',
          decidedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
    workflowTrustDecideMock.mockResolvedValue({})
    render(<TrustedSourcesList settings={settings} />)

    await waitFor(() => expect(screen.getByText('acme-decks')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Trust' }))

    await waitFor(() =>
      expect(workflowTrustDecideMock).toHaveBeenCalledWith(settings, {
        source: 'acme-decks',
        decision: 'trusted',
        host: 'ssh:devbox'
      })
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument())
  })

  it('disables every Revoke button with an explanation when the host does not support revoke', async () => {
    workflowTrustListMock.mockResolvedValue({
      decisions: [
        {
          source: 'a',
          host: 'local',
          decision: 'trusted',
          decidedBy: 'user',
          decidedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          source: 'b',
          host: 'local',
          decision: 'trusted',
          decidedBy: 'user',
          decidedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
    workflowTrustRevokeMock.mockRejectedValue(
      Object.assign(new Error('unknown method'), { code: 'method_not_found' })
    )
    render(<TrustedSourcesList settings={settings} />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])

    await waitFor(() =>
      expect(
        screen.getByText(
          "This host's Orca must be updated to revoke trust. Meanwhile, run `orca workflows trust <source> --decision refused` from a shell on that host to refuse a source instead."
        )
      ).toBeInTheDocument()
    )
    for (const button of screen.getAllByRole('button', { name: 'Revoke' })) {
      expect(button).toBeDisabled()
    }
    // Both rows are still trusted — a decode failure never falls back to recording `refused`.
    expect(screen.getAllByText(/^Trusted/)).toHaveLength(2)
  })

  it('resets the revoke-unsupported state when the active runtime environment changes', async () => {
    workflowTrustListMock.mockResolvedValue({
      decisions: [
        {
          source: 'a',
          host: 'local',
          decision: 'trusted',
          decidedBy: 'user',
          decidedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
    workflowTrustRevokeMock.mockRejectedValue(
      Object.assign(new Error('unknown method'), { code: 'method_not_found' })
    )
    const { rerender } = render(
      <TrustedSourcesList settings={{ activeRuntimeEnvironmentId: 'env-1' }} />
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled())

    // Switching hosts: a different host may well support revoke even though the last one didn't.
    rerender(<TrustedSourcesList settings={{ activeRuntimeEnvironmentId: 'env-2' }} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled())
  })

  it('shows the RPC error inline for a non-capability revoke failure, without disabling other rows', async () => {
    workflowTrustListMock.mockResolvedValue({
      decisions: [
        {
          source: 'a',
          host: 'local',
          decision: 'trusted',
          decidedBy: 'user',
          decidedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
    workflowTrustRevokeMock.mockRejectedValue(new Error('runtime_unavailable'))
    render(<TrustedSourcesList settings={settings} />)

    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(screen.getByText('runtime_unavailable')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled()
  })

  it('shows the RPC error inline when the list fails to load', async () => {
    workflowTrustListMock.mockRejectedValue(new Error('runtime_unavailable'))
    render(<TrustedSourcesList settings={settings} />)

    await waitFor(() => expect(screen.getByText('runtime_unavailable')).toBeInTheDocument())
  })

  it('re-fetches only when the active runtime environment id changes, not on every settings object', async () => {
    workflowTrustListMock.mockResolvedValue({ decisions: [] })
    const { rerender } = render(
      <TrustedSourcesList settings={{ activeRuntimeEnvironmentId: 'env-1' }} />
    )
    await waitFor(() => expect(workflowTrustListMock).toHaveBeenCalledTimes(1))

    // A new settings object with the same runtime environment id must not re-fetch.
    rerender(<TrustedSourcesList settings={{ activeRuntimeEnvironmentId: 'env-1' }} />)
    expect(workflowTrustListMock).toHaveBeenCalledTimes(1)

    rerender(<TrustedSourcesList settings={{ activeRuntimeEnvironmentId: 'env-2' }} />)
    await waitFor(() => expect(workflowTrustListMock).toHaveBeenCalledTimes(2))
  })
})
