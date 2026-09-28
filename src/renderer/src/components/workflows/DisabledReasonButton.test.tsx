// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import DisabledReasonButton, { type DisabledReasonButtonProps } from './DisabledReasonButton'

afterEach(() => {
  cleanup()
})

function renderButton(props: DisabledReasonButtonProps): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <DisabledReasonButton {...props} />
    </TooltipProvider>
  )
}

describe('DisabledReasonButton', () => {
  it('is enabled with no tooltip when there is no reason and no enabled content', async () => {
    const user = userEvent.setup()
    renderButton({ reason: undefined, onClick: vi.fn(), children: 'Save' })

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).not.toHaveAttribute('aria-disabled', 'true')

    await user.hover(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('marks itself aria-disabled, not DOM-disabled, when a reason is given', () => {
    renderButton({ reason: 'Fix the problems first.', onClick: vi.fn(), children: 'Save' })

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('explains the reason on hover', async () => {
    const user = userEvent.setup()
    renderButton({ reason: 'Fix the problems first.', onClick: vi.fn(), children: 'Save' })

    await user.hover(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByText('Fix the problems first.')).length).toBeGreaterThan(0)
  })

  it('swallows the click while disabled', () => {
    const onClick = vi.fn()
    renderButton({ reason: 'Fix the problems first.', onClick, children: 'Save' })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('calls onClick when enabled', () => {
    const onClick = vi.fn()
    renderButton({ reason: undefined, onClick, children: 'Save' })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('shows enabledTooltip content when enabled and a reason when disabled', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <TooltipProvider>
        <DisabledReasonButton reason={undefined} enabledTooltip="Shortcut hint" onClick={vi.fn()}>
          Undo
        </DisabledReasonButton>
      </TooltipProvider>
    )

    await user.hover(screen.getByRole('button', { name: 'Undo' }))
    expect((await screen.findAllByText('Shortcut hint')).length).toBeGreaterThan(0)

    rerender(
      <TooltipProvider>
        <DisabledReasonButton
          reason="Nothing to undo yet."
          enabledTooltip="Shortcut hint"
          onClick={vi.fn()}
        >
          Undo
        </DisabledReasonButton>
      </TooltipProvider>
    )
    await user.unhover(screen.getByRole('button', { name: 'Undo' }))
    await user.hover(screen.getByRole('button', { name: 'Undo' }))
    expect((await screen.findAllByText('Nothing to undo yet.')).length).toBeGreaterThan(0)
  })

  // The Tooltip must stay mounted so a reason appearing/disappearing never swaps <Button> for a
  // <Tooltip>-wrapped one at the same JSX position (that remounts the button and drops focus).
  it('keeps focus on the button when a disabled reason appears after a keyboard activation', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = renderButton({ reason: undefined, onClick, children: 'Save' })

    const button = screen.getByRole('button', { name: 'Save' })
    button.focus()
    expect(button).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()

    // Simulate the save completing and the workflow becoming clean: the reason now exists.
    rerender(
      <TooltipProvider>
        <DisabledReasonButton reason="No changes to save yet." onClick={onClick}>
          Save
        </DisabledReasonButton>
      </TooltipProvider>
    )

    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  })

  it('never warns Radix about switching the Tooltip between controlled and uncontrolled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = renderButton({ reason: undefined, onClick: vi.fn(), children: 'Save' })

    rerender(
      <TooltipProvider>
        <DisabledReasonButton reason="No changes to save yet." onClick={vi.fn()}>
          Save
        </DisabledReasonButton>
      </TooltipProvider>
    )
    rerender(
      <TooltipProvider>
        <DisabledReasonButton reason={undefined} onClick={vi.fn()}>
          Save
        </DisabledReasonButton>
      </TooltipProvider>
    )

    const allCalls = [...warn.mock.calls, ...error.mock.calls]
    const controlledWarning = allCalls.some(
      (call) => String(call[0]).includes('changing') && String(call[0]).includes('controlled')
    )
    expect(controlledWarning).toBe(false)
    warn.mockRestore()
    error.mockRestore()
  })

  // A tooltip must only be open while the trigger is hovered or focused, whether or not a
  // reason exists right now. Hovering an enabled control with nothing to say, then leaving,
  // must not leave a stale "open" intent that pops the tooltip open later when a reason appears
  // with no further hover or focus at all.
  it('never pops the tooltip open on its own once a reason appears after an earlier hover', async () => {
    const user = userEvent.setup()
    const { rerender } = renderButton({ reason: undefined, onClick: vi.fn(), children: 'Save' })

    await user.hover(screen.getByRole('button', { name: 'Save' }))
    await user.unhover(screen.getByRole('button', { name: 'Save' }))

    rerender(
      <TooltipProvider>
        <DisabledReasonButton reason="No changes to save yet." onClick={vi.fn()}>
          Save
        </DisabledReasonButton>
      </TooltipProvider>
    )

    expect(screen.queryAllByText('No changes to save yet.').length).toBe(0)
  })

  // Same scenario, in the exact prop shape WorkflowListPane's icon buttons use (ghost, icon-xs,
  // no enabledTooltip, sr-only label as the only accessible name) — F6 adopted this component for
  // its "New workflow" / "Draft from objective" buttons, which hit the same bug.
  it('never pops the tooltip open for an icon-only, ghost-variant caller either', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <TooltipProvider>
        <DisabledReasonButton variant="ghost" size="icon-xs" reason={undefined} onClick={vi.fn()}>
          <span aria-hidden="true">+</span>
          <span className="sr-only">New workflow</span>
        </DisabledReasonButton>
      </TooltipProvider>
    )

    const button = screen.getByRole('button', { name: 'New workflow' })
    await user.hover(button)
    await user.unhover(button)

    rerender(
      <TooltipProvider>
        <DisabledReasonButton
          variant="ghost"
          size="icon-xs"
          reason="Add or select a project to create workflows."
          onClick={vi.fn()}
        >
          <span aria-hidden="true">+</span>
          <span className="sr-only">New workflow</span>
        </DisabledReasonButton>
      </TooltipProvider>
    )

    expect(screen.queryAllByText('Add or select a project to create workflows.').length).toBe(0)
  })
})
