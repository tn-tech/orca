// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import RunToolbar from './RunToolbar'

afterEach(() => {
  cleanup()
})

describe('RunToolbar', () => {
  it('runs with the typed objective and requires one before enabling Run', () => {
    const onRun = vi.fn()
    render(
      <TooltipProvider>
        <RunToolbar canRun starting={false} stopping={false} onRun={onRun} onStop={vi.fn()} />
      </TooltipProvider>
    )

    expect(screen.getByRole('button', { name: 'Run' })).toHaveAttribute('aria-disabled', 'true')

    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Add CSV export' }
    })
    const runButton = screen.getByRole('button', { name: 'Run' })
    expect(runButton).not.toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(runButton)
    expect(onRun).toHaveBeenCalledWith('Add CSV export')
  })

  it('disables Run while validation problems block it, with a fallback reason', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <RunToolbar
          canRun={false}
          starting={false}
          stopping={false}
          onRun={vi.fn()}
          onStop={vi.fn()}
        />
      </TooltipProvider>
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Add CSV export' }
    })

    const runButton = screen.getByRole('button', { name: 'Run' })
    expect(runButton).toHaveAttribute('aria-disabled', 'true')

    await user.hover(runButton)
    expect((await screen.findAllByText("Can't run yet.")).length).toBeGreaterThan(0)
  })

  // F5: an empty objective used to disable Run with no explanation anywhere (audit B2).
  it('explains an empty objective on hover, not DOM-disabled', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <RunToolbar canRun starting={false} stopping={false} onRun={vi.fn()} onStop={vi.fn()} />
      </TooltipProvider>
    )

    const runButton = screen.getByRole('button', { name: 'Run' })
    expect(runButton).not.toBeDisabled()
    expect(runButton).toHaveAttribute('aria-disabled', 'true')

    await user.hover(runButton)
    expect((await screen.findAllByText('Enter an objective.')).length).toBeGreaterThan(0)
  })

  it('swallows the click while Run is disabled', () => {
    const onRun = vi.fn()
    render(
      <TooltipProvider>
        <RunToolbar
          canRun={false}
          starting={false}
          stopping={false}
          onRun={onRun}
          onStop={vi.fn()}
        />
      </TooltipProvider>
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Add CSV export' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(onRun).not.toHaveBeenCalled()
  })

  it('shows Stop instead of Run once a run is active, with the objective read-only', () => {
    const onStop = vi.fn()
    render(
      <TooltipProvider>
        <RunToolbar
          canRun
          starting={false}
          stopping={false}
          runState="running"
          runObjective="Add CSV export"
          onRun={vi.fn()}
          onStop={onStop}
        />
      </TooltipProvider>
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
      <TooltipProvider>
        <RunToolbar
          canRun
          starting={false}
          stopping={false}
          runState="completed"
          runObjective="Add CSV export"
          onRun={vi.fn()}
          onStop={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(screen.getByRole('textbox', { name: 'Objective' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  // F5: disabledReason (draft/blocking-problems, set by WorkflowsPage) takes priority over the
  // local empty-objective reason, and must reach hover/screen-readers via aria-disabled.
  it('explains an external disabledReason (e.g. an unsaved draft) on hover', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <RunToolbar
          canRun={false}
          disabledReason="Save this draft before running it."
          starting={false}
          stopping={false}
          onRun={vi.fn()}
          onStop={vi.fn()}
        />
      </TooltipProvider>
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Add CSV export' }
    })

    const runButton = screen.getByRole('button', { name: 'Run' })
    expect(runButton).not.toHaveAttribute('title')
    expect(runButton).toHaveAttribute('aria-disabled', 'true')

    await user.hover(runButton)
    expect(
      (await screen.findAllByText('Save this draft before running it.')).length
    ).toBeGreaterThan(0)
  })

  it('explains a starting run on hover', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <RunToolbar canRun starting stopping={false} onRun={vi.fn()} onStop={vi.fn()} />
      </TooltipProvider>
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Add CSV export' }
    })

    const runButton = screen.getByRole('button', { name: 'Run' })
    await user.hover(runButton)
    expect((await screen.findAllByText('Starting the run…')).length).toBeGreaterThan(0)
  })

  // Controller ruling, F5 fix round 1: Re-layout moved next to Add node / Wrap in Loop in
  // WorkflowsPage.tsx, so RunToolbar's own wrap no longer competes with the outer toolbar's.
  it('has a visible Objective label', () => {
    render(
      <TooltipProvider>
        <RunToolbar canRun starting={false} stopping={false} onRun={vi.fn()} onStop={vi.fn()} />
      </TooltipProvider>
    )

    expect(screen.getByText('Objective')).not.toHaveClass('sr-only')
  })
})
