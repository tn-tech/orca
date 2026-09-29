// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BackToEditingButton from './BackToEditingButton'

afterEach(cleanup)

describe('BackToEditingButton', () => {
  it('leaves the run view when clicked (F9)', () => {
    const onClick = vi.fn()
    render(<BackToEditingButton onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to editing' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
