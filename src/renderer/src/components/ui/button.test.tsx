// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from './button'

afterEach(() => {
  cleanup()
})

describe('Button softDisabled', () => {
  it('defaults to off: an ordinary Button is unaffected', () => {
    render(<Button>Save</Button>)

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).not.toHaveClass('opacity-50')
    expect(button).not.toHaveClass('cursor-not-allowed')
    expect(button).toHaveClass('hover:bg-primary/90')
  })

  it('dims the whole default-variant button and pins hover to its resting background', () => {
    render(<Button softDisabled>Save</Button>)

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveClass('opacity-50')
    expect(button).toHaveClass('cursor-not-allowed')
    // twMerge drops the conflicting hover:bg-primary/90 in favor of this override.
    expect(button).toHaveClass('hover:bg-primary')
    expect(button).not.toHaveClass('hover:bg-primary/90')
  })

  it('pins hover to the resting background for the outline variant too', () => {
    render(
      <Button variant="outline" softDisabled>
        History
      </Button>
    )

    const button = screen.getByRole('button', { name: 'History' })
    expect(button).toHaveClass('opacity-50')
    expect(button).toHaveClass('hover:bg-background')
    expect(button).not.toHaveClass('hover:bg-accent')
  })

  it('pins the outline variant border in dark mode too, not just light', () => {
    render(
      <Button variant="outline" softDisabled>
        History
      </Button>
    )

    const button = screen.getByRole('button', { name: 'History' })
    // Resting outline border is border-border (light) / dark:border-input (dark); the hover
    // pin must cover both, or a dark-theme hover still shifts the border.
    expect(button).toHaveClass('hover:border-border')
    expect(button).toHaveClass('dark:hover:border-input')
  })

  it('does not force a text color on the ghost variant, which has none at rest', () => {
    render(
      <Button variant="ghost" softDisabled>
        Draft
      </Button>
    )

    const button = screen.getByRole('button', { name: 'Draft' })
    expect(button).toHaveClass('hover:bg-transparent')
    // Ghost's resting state sets no text color at all, so a soft-disabled hover must not
    // introduce one either — that would shift a caller's own muted-text className.
    expect(button).not.toHaveClass('hover:text-foreground')
  })

  it('stays a plain, focusable button — softDisabled never sets the native disabled attribute', () => {
    render(<Button softDisabled>Save</Button>)

    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })
})
