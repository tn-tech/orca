// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import SaveWorkflowButton, { type SaveWorkflowButtonProps } from './SaveWorkflowButton'

afterEach(() => {
  cleanup()
})

function renderButton(props: SaveWorkflowButtonProps): void {
  render(
    <TooltipProvider>
      <SaveWorkflowButton {...props} />
    </TooltipProvider>
  )
}

describe('SaveWorkflowButton', () => {
  it('is enabled with no tooltip reason when dirty and unblocked', () => {
    renderButton({
      dirty: true,
      isDraft: false,
      saving: false,
      blockingProblems: false,
      onClick: vi.fn()
    })

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('explains blocking problems on hover, not DOM-disabled (F5)', async () => {
    const user = userEvent.setup()
    renderButton({
      dirty: true,
      isDraft: false,
      saving: false,
      blockingProblems: true,
      onClick: vi.fn()
    })

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')

    await user.hover(button)
    expect(
      (await screen.findAllByText('Fix the problems below before saving.')).length
    ).toBeGreaterThan(0)
  })

  it('explains a clean, non-draft workflow on hover', async () => {
    const user = userEvent.setup()
    renderButton({
      dirty: false,
      isDraft: false,
      saving: false,
      blockingProblems: false,
      onClick: vi.fn()
    })

    await user.hover(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByText('No changes to save yet.')).length).toBeGreaterThan(0)
  })

  it('swallows the click while blocked', () => {
    const onClick = vi.fn()
    renderButton({ dirty: true, isDraft: false, saving: false, blockingProblems: true, onClick })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('calls onClick when enabled', () => {
    const onClick = vi.fn()
    renderButton({ dirty: true, isDraft: false, saving: false, blockingProblems: false, onClick })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is not draft-blocked: a draft stays enabled even when not dirty', () => {
    renderButton({
      dirty: false,
      isDraft: true,
      saving: false,
      blockingProblems: false,
      onClick: vi.fn()
    })

    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('explains that a save is already in flight', async () => {
    const user = userEvent.setup()
    renderButton({
      dirty: true,
      isDraft: false,
      saving: true,
      blockingProblems: false,
      onClick: vi.fn()
    })

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('aria-disabled', 'true')

    await user.hover(button)
    expect((await screen.findAllByText('Saving…')).length).toBeGreaterThan(0)
  })

  it('keeps focus after Enter while dirty makes it un-dirty and disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(
      <TooltipProvider>
        <SaveWorkflowButton
          dirty
          isDraft={false}
          saving={false}
          blockingProblems={false}
          onClick={onClick}
        />
      </TooltipProvider>
    )

    const button = screen.getByRole('button', { name: 'Save' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()

    rerender(
      <TooltipProvider>
        <SaveWorkflowButton
          dirty={false}
          isDraft={false}
          saving={false}
          blockingProblems={false}
          onClick={onClick}
        />
      </TooltipProvider>
    )

    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  })

  // Reproduces the reviewer's exact scenario: hover Save while dirty (enabled, no reason), leave,
  // then let it become clean with no further hover or focus at all — the reason must not pop up.
  it('never pops the tooltip open once it becomes clean after an earlier hover', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <TooltipProvider>
        <SaveWorkflowButton
          dirty
          isDraft={false}
          saving={false}
          blockingProblems={false}
          onClick={vi.fn()}
        />
      </TooltipProvider>
    )

    const button = screen.getByRole('button', { name: 'Save' })
    await user.hover(button)
    await user.unhover(button)

    rerender(
      <TooltipProvider>
        <SaveWorkflowButton
          dirty={false}
          isDraft={false}
          saving={false}
          blockingProblems={false}
          onClick={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(screen.queryAllByText('No changes to save yet.').length).toBe(0)
  })
})
