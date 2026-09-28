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

  it('dims the whole button and shows a not-allowed cursor', () => {
    render(<Button softDisabled>Save</Button>)

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveClass('opacity-50')
    expect(button).toHaveClass('cursor-not-allowed')
    expect(button).not.toHaveClass('cursor-pointer')
  })

  it('stays a plain, focusable button — softDisabled never sets the native disabled attribute', () => {
    render(<Button softDisabled>Save</Button>)

    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })
})

const VARIANTS = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const

function hoverClasses(element: HTMLElement): string[] {
  return [...element.classList].filter((token) => token.split(':').includes('hover'))
}

describe('Button softDisabled hover', () => {
  it.each(VARIANTS)('%s: soft-disabled drops every hover style the variant has', (variant) => {
    render(
      <>
        <Button variant={variant}>Enabled</Button>
        <Button variant={variant} softDisabled>
          Soft
        </Button>
      </>
    )

    const enabled = screen.getByRole('button', { name: 'Enabled' })
    const soft = screen.getByRole('button', { name: 'Soft' })
    // Sanity: the variant really has hover styling to neutralise.
    expect(hoverClasses(enabled).length).toBeGreaterThan(0)
    expect(hoverClasses(soft)).toEqual([])
  })

  it.each(VARIANTS)('%s: soft-disabled keeps the resting look, only dimmed', (variant) => {
    render(
      <>
        <Button variant={variant}>Enabled</Button>
        <Button variant={variant} softDisabled>
          Soft
        </Button>
      </>
    )

    const enabled = screen.getByRole('button', { name: 'Enabled' })
    const soft = screen.getByRole('button', { name: 'Soft' })
    const hover = new Set(hoverClasses(enabled))
    const resting = [...enabled.classList].filter((token) => !hover.has(token)).sort()
    const softResting = [...soft.classList]
      .filter((token) => token !== 'opacity-50' && token !== 'cursor-not-allowed')
      .concat('cursor-pointer')
      .sort()
    expect(softResting).toEqual(resting)
  })
})
