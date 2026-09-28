// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunControls from './RunControls'

afterEach(() => {
  cleanup()
})

describe('RunControls', () => {
  it('renders nothing before a run exists', () => {
    const { container } = render(
      <RunControls
        runState={undefined}
        pausing={false}
        resuming={false}
        cancelling={false}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing once the run reaches a terminal state', () => {
    const { container } = render(
      <RunControls
        runState="completed"
        pausing={false}
        resuming={false}
        cancelling={false}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('disables Pause for a queued run (RUN_TRANSITIONS has no queued -> paused)', () => {
    render(
      <RunControls
        runState="queued"
        pausing={false}
        resuming={false}
        cancelling={false}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
  })

  it('calls onPause for a running run', () => {
    const onPause = vi.fn()
    render(
      <RunControls
        runState="running"
        pausing={false}
        resuming={false}
        cancelling={false}
        onPause={onPause}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    const pauseButton = screen.getByRole('button', { name: 'Pause' })
    expect(pauseButton).toBeEnabled()
    fireEvent.click(pauseButton)
    expect(onPause).toHaveBeenCalled()
  })

  it('shows Resume instead of Pause once paused, and calls onResume', () => {
    const onResume = vi.fn()
    render(
      <RunControls
        runState="paused"
        pausing={false}
        resuming={false}
        cancelling={false}
        onPause={vi.fn()}
        onResume={onResume}
        onCancel={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(onResume).toHaveBeenCalled()
  })

  it('asks for confirmation before cancelling, and only calls onCancel once confirmed', () => {
    const onCancel = vi.fn()
    render(
      <RunControls
        runState="running"
        pausing={false}
        resuming={false}
        cancelling={false}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByText('Cancel this run?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('dismissing the confirmation keeps the run going', () => {
    const onCancel = vi.fn()
    render(
      <RunControls
        runState="running"
        pausing={false}
        resuming={false}
        cancelling={false}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep running' }))
    expect(onCancel).not.toHaveBeenCalled()
  })
})
