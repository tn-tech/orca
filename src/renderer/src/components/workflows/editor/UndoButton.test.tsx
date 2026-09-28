// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  it('is disabled when there is nothing to undo', () => {
    renderUndoButton({ canUndo: false, onUndo: vi.fn() })

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('is enabled and calls onUndo when clicked', () => {
    const onUndo = vi.fn()
    renderUndoButton({ canUndo: true, onUndo })

    const button = screen.getByRole('button', { name: 'Undo' })
    expect(button).not.toBeDisabled()
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
