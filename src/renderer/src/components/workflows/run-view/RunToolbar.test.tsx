// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunToolbar from './RunToolbar'

afterEach(() => {
  cleanup()
})

describe('RunToolbar', () => {
  it('runs with the typed objective and requires one before enabling Run', () => {
    const onRun = vi.fn()
    render(
      <RunToolbar
        canRun
        starting={false}
        stopping={false}
        onRun={onRun}
        onStop={vi.fn()}
        onRelayout={vi.fn()}
      />
    )

    const runButton = screen.getByRole('button', { name: 'Run' })
    expect(runButton).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Add CSV export' }
    })
    expect(runButton).toBeEnabled()

    fireEvent.click(runButton)
    expect(onRun).toHaveBeenCalledWith('Add CSV export')
  })

  it('disables Run while validation problems block it', () => {
    render(
      <RunToolbar
        canRun={false}
        starting={false}
        stopping={false}
        onRun={vi.fn()}
        onStop={vi.fn()}
        onRelayout={vi.fn()}
      />
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Add CSV export' }
    })

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })

  it('shows Stop instead of Run once a run is active, with the objective read-only', () => {
    const onStop = vi.fn()
    render(
      <RunToolbar
        canRun
        starting={false}
        stopping={false}
        runState="running"
        runObjective="Add CSV export"
        onRun={vi.fn()}
        onStop={onStop}
        onRelayout={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Objective' })).not.toBeInTheDocument()
    expect(screen.getByText('Add CSV export')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })

  it('allows starting a new run once the previous one reached a terminal state', () => {
    render(
      <RunToolbar
        canRun
        starting={false}
        stopping={false}
        runState="completed"
        runObjective="Add CSV export"
        onRun={vi.fn()}
        onStop={vi.fn()}
        onRelayout={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox', { name: 'Objective' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('shows disabledReason as the Run button title when Run is disabled', () => {
    render(
      <RunToolbar
        canRun={false}
        disabledReason="Save this draft before running it."
        starting={false}
        stopping={false}
        onRun={vi.fn()}
        onStop={vi.fn()}
        onRelayout={vi.fn()}
      />
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Add CSV export' }
    })

    expect(screen.getByRole('button', { name: 'Run' })).toHaveAttribute(
      'title',
      'Save this draft before running it.'
    )
  })

  it('calls onRelayout from the Re-layout action', () => {
    const onRelayout = vi.fn()
    render(
      <RunToolbar
        canRun
        starting={false}
        stopping={false}
        onRun={vi.fn()}
        onStop={vi.fn()}
        onRelayout={onRelayout}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Re-layout' }))
    expect(onRelayout).toHaveBeenCalled()
  })
})
