// @vitest-environment happy-dom
// F6: a hidden Workflows sidebar button had no way back in besides an easy-to-miss Appearance
// setting. Turning Experimental → Workflows back on must restore it.
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { WorkflowsExperimentalSetting } from './WorkflowsExperimentalSetting'

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))

afterEach(() => {
  cleanup()
})

describe('WorkflowsExperimentalSetting', () => {
  it('restores the hidden Workflows sidebar button when turned on', () => {
    const updateSettings = vi.fn()
    const settings = {
      ...getDefaultSettings('/tmp'),
      experimentalWorkflows: false,
      showWorkflowsButton: false
    }
    render(<WorkflowsExperimentalSetting settings={settings} updateSettings={updateSettings} />)

    fireEvent.click(screen.getByRole('switch'))

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      experimentalWorkflows: true,
      showWorkflowsButton: true
    })
  })

  it('does not touch the button visibility preference when turning the experiment off', () => {
    const updateSettings = vi.fn()
    const settings = {
      ...getDefaultSettings('/tmp'),
      experimentalWorkflows: true,
      showWorkflowsButton: false
    }
    render(<WorkflowsExperimentalSetting settings={settings} updateSettings={updateSettings} />)

    fireEvent.click(screen.getByRole('switch'))

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ experimentalWorkflows: false })
  })
})
