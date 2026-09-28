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

  // disabledReason (draft/blocking-problems, set by WorkflowsPage) takes priority over the local
  // empty-objective reason, and must reach hover/screen-readers via aria-disabled.
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

  it('has a visible Objective label', () => {
    render(
      <TooltipProvider>
        <RunToolbar canRun starting={false} stopping={false} onRun={vi.fn()} onStop={vi.fn()} />
      </TooltipProvider>
    )

    expect(screen.getByText('Objective')).not.toHaveClass('sr-only')
  })

  // The run group wraps as one unit in the caller's row: objective, state and Run/controls share
  // one non-wrapping container whose min-content (not an explicit min-w) decides when it wraps.
  it('renders the objective, state and Run as one non-wrapping unit', () => {
    render(
      <TooltipProvider>
        <div data-testid="outer-row">
          <RunToolbar
            canRun
            starting={false}
            runState="cancelled"
            runObjective="Say hello"
            onRun={vi.fn()}
          />
        </div>
      </TooltipProvider>
    )

    const outer = screen.getByTestId('outer-row')
    expect(outer.children.length).toBe(1)
    const unit = outer.children[0]
    expect(unit).toContainElement(screen.getByRole('textbox', { name: 'Objective' }))
    expect(unit).toContainElement(screen.getByText('Cancelled'))
    expect(unit).toContainElement(screen.getByRole('button', { name: 'Run' }))
    expect(unit).toHaveClass('flex-1')
    expect(unit).not.toHaveClass('flex-wrap')
    expect([...unit.classList].some((token) => token.startsWith('min-w-'))).toBe(false)
  })

  it('keeps the read-only objective in the same unit as the state and runControls while active', () => {
    render(
      <TooltipProvider>
        <div data-testid="outer-row">
          <RunToolbar
            canRun
            starting={false}
            runState="paused"
            runObjective="Say hello"
            onRun={vi.fn()}
            runControls={<button type="button">Resume</button>}
          />
        </div>
      </TooltipProvider>
    )

    const outer = screen.getByTestId('outer-row')
    expect(outer.children.length).toBe(1)
    const unit = outer.children[0]
    expect(unit).toContainElement(screen.getByText('Say hello'))
    expect(unit).toContainElement(screen.getByText('Paused'))
    expect(unit).toContainElement(screen.getByRole('button', { name: 'Resume' }))
  })

  // A run's state and its controls must wrap as one unit, never split across lines — so they
  // have to share a single parent element, not sit as independent items in the caller's row.
  it('renders the run state and runControls as one shared unit while active', () => {
    render(
      <TooltipProvider>
        <RunToolbar
          canRun
          starting={false}
          stopping={false}
          runState="paused"
          runObjective="Say hello"
          onRun={vi.fn()}
          runControls={<button type="button">Resume</button>}
        />
      </TooltipProvider>
    )

    const state = screen.getByText('Paused')
    const resume = screen.getByRole('button', { name: 'Resume' })
    expect(state.parentElement).toBe(resume.parentElement)
  })

  it('keeps the state label alongside Run once a run reaches a terminal state, not inside the shrinking objective group', () => {
    render(
      <TooltipProvider>
        <RunToolbar
          canRun
          starting={false}
          stopping={false}
          runState="cancelled"
          runObjective="Say hello"
          onRun={vi.fn()}
        />
      </TooltipProvider>
    )

    const state = screen.getByText('Cancelled')
    const runButton = screen.getByRole('button', { name: 'Run' })
    expect(state.parentElement).toBe(runButton.parentElement)
    expect(state.parentElement).not.toHaveClass('min-w-48')
  })

  // Reproduces the reviewer's exact scenario: hover Run while enabled (no reason), leave, then
  // let a reason appear with no further hover or focus at all — the tooltip must stay closed.
  it('never pops the tooltip open on Run once the objective is cleared after an earlier hover', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <RunToolbar canRun starting={false} stopping={false} onRun={vi.fn()} onStop={vi.fn()} />
      </TooltipProvider>
    )

    const objectiveInput = screen.getByRole('textbox', { name: 'Objective' })
    fireEvent.change(objectiveInput, { target: { value: 'Add CSV export' } })

    const runButton = screen.getByRole('button', { name: 'Run' })
    await user.hover(runButton)
    await user.unhover(runButton)

    fireEvent.change(objectiveInput, { target: { value: '' } })

    expect(screen.queryAllByText('Enter an objective.').length).toBe(0)
  })
})
