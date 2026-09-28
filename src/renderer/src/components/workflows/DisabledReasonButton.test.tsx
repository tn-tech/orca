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
})
