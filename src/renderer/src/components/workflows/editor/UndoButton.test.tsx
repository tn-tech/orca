// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import UndoButton, { type UndoButtonProps } from './UndoButton'

afterEach(() => {
  cleanup()
})

function renderUndoButton(props: UndoButtonProps): void {
  render(
    <TooltipProvider>
      <UndoButton {...props} />
    </TooltipProvider>
  )
}

describe('UndoButton', () => {
  // F5: a native `disabled` button loses pointer events in Chromium (hides the Radix tooltip)
  // and drops out of the tab order (hides the reason from screen readers), so a disabled reason
  // must reach hover/focus via `aria-disabled`, not `disabled` — see `action-button.tsx`.
  it('marks itself aria-disabled (not DOM-disabled) when there is nothing to undo', () => {
    renderUndoButton({ canUndo: false, onUndo: vi.fn() })

    const button = screen.getByRole('button', { name: 'Undo' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('explains why on hover when there is nothing to undo', async () => {
    const user = userEvent.setup()
    renderUndoButton({ canUndo: false, onUndo: vi.fn() })

    await user.hover(screen.getByRole('button', { name: 'Undo' }))
    expect((await screen.findAllByText('Nothing to undo yet.')).length).toBeGreaterThan(0)
  })

  it('swallows the click while disabled', () => {
    const onUndo = vi.fn()
    renderUndoButton({ canUndo: false, onUndo })

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('is enabled and calls onUndo when clicked', () => {
    const onUndo = vi.fn()
    renderUndoButton({ canUndo: true, onUndo })

    const button = screen.getByRole('button', { name: 'Undo' })
    expect(button).not.toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button)

    expect(onUndo).toHaveBeenCalledOnce()
  })

  // F4 review round 1, Minor #5: the disabled reason (and the shortcut) used to be a `title`
  // attribute — STYLEGUIDE puts a shortcut chip in a Tooltip's `<ShortcutKeyCombo />` instead.
  it('does not fall back to a title attribute', () => {
    renderUndoButton({ canUndo: true, onUndo: vi.fn() })

    expect(screen.getByRole('button', { name: 'Undo' })).not.toHaveAttribute('title')
  })
})
