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

  it('is not draft-blocked: a dirty draft stays enabled with no reason', () => {
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
})
