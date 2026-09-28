// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UndoButton from './UndoButton'

afterEach(() => {
  cleanup()
})

describe('UndoButton', () => {
  it('is disabled when there is nothing to undo', () => {
    render(<UndoButton canUndo={false} onUndo={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('is enabled and calls onUndo when clicked', () => {
    const onUndo = vi.fn()
    render(<UndoButton canUndo={true} onUndo={onUndo} />)

    const button = screen.getByRole('button', { name: 'Undo' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)

    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('stays disabled while a run is shown, even with history available (F4)', () => {
    render(<UndoButton canUndo={true} disabled onUndo={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Undo' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Undo is disabled while a run is shown.')
  })
})
