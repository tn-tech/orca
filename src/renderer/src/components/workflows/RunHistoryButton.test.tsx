// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import RunHistoryButton from './RunHistoryButton'

afterEach(() => {
  cleanup()
})

describe('RunHistoryButton', () => {
  it('is enabled with no tooltip reason when a workflow is open', () => {
    render(
      <TooltipProvider>
        <RunHistoryButton reason={undefined} onClick={vi.fn()} />
      </TooltipProvider>
    )

    expect(screen.getByRole('button', { name: 'History' })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('explains why on hover instead of going DOM-disabled (F5)', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <RunHistoryButton reason="Save the workflow first." onClick={vi.fn()} />
      </TooltipProvider>
    )

    const button = screen.getByRole('button', { name: 'History' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')

    await user.hover(button)
    expect((await screen.findAllByText('Save the workflow first.')).length).toBeGreaterThan(0)
  })

  it('swallows the click while disabled', () => {
    const onClick = vi.fn()
    render(
      <TooltipProvider>
        <RunHistoryButton reason="Save the workflow first." onClick={onClick} />
      </TooltipProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('calls onClick when enabled', () => {
    const onClick = vi.fn()
    render(
      <TooltipProvider>
        <RunHistoryButton reason={undefined} onClick={onClick} />
      </TooltipProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
