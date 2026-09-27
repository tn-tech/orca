// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { WorkflowsTrustExperimentalSetting } from './WorkflowsTrustExperimentalSetting'

const { trustedSourcesListMock } = vi.hoisted(() => ({
  trustedSourcesListMock: vi.fn(() => <div data-testid="trusted-sources-list" />)
}))

vi.mock('../workflows/TrustedSourcesList', () => ({ default: trustedSourcesListMock }))
vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))

afterEach(() => {
  cleanup()
  trustedSourcesListMock.mockClear()
})

describe('WorkflowsTrustExperimentalSetting', () => {
  it('shows the section heading and mounts the shared trust list', () => {
    const settings = getDefaultSettings('/tmp')
    render(<WorkflowsTrustExperimentalSetting settings={settings} />)

    expect(screen.getByText('Trusted skill sources')).toBeInTheDocument()
    expect(screen.getByTestId('trusted-sources-list')).toBeInTheDocument()
    expect(trustedSourcesListMock).toHaveBeenCalledWith({ settings }, undefined)
  })
})
