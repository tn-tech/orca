// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TrustedSourcesDialog from './TrustedSourcesDialog'

const { trustedSourcesListMock } = vi.hoisted(() => ({
  trustedSourcesListMock: vi.fn(() => <div data-testid="trusted-sources-list" />)
}))

vi.mock('./TrustedSourcesList', () => ({ default: trustedSourcesListMock }))

afterEach(() => {
  cleanup()
  trustedSourcesListMock.mockClear()
})

const settings = { activeRuntimeEnvironmentId: null }

describe('TrustedSourcesDialog', () => {
  it('shows the dialog chrome and mounts the shared trust list while open', () => {
    render(<TrustedSourcesDialog open settings={settings} onOpenChange={vi.fn()} />)

    expect(screen.getByText('Trusted skill sources')).toBeInTheDocument()
    expect(screen.getByTestId('trusted-sources-list')).toBeInTheDocument()
    expect(trustedSourcesListMock).toHaveBeenCalledWith({ settings }, undefined)
  })

  it('does not mount the list while closed', () => {
    render(<TrustedSourcesDialog open={false} settings={settings} onOpenChange={vi.fn()} />)

    expect(screen.queryByTestId('trusted-sources-list')).not.toBeInTheDocument()
    expect(trustedSourcesListMock).not.toHaveBeenCalled()
  })
})
