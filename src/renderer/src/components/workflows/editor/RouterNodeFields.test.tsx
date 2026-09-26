// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  RouterNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import RouterNodeFields from './RouterNodeFields'

afterEach(() => {
  cleanup()
})

function routerNode(patch: Partial<RouterNode> = {}): RouterNode {
  return {
    id: 'router',
    type: 'router',
    title: 'Router',
    prompt: 'Decide bugfix or feature.',
    choices: ['bugfix', 'feature'],
    ...patch
  }
}

const noRoles: Workflow['roles'] = {}

describe('RouterNodeFields (FR-029)', () => {
  it('renders the shared role/model/prompt fields', () => {
    render(<RouterNodeFields node={routerNode()} roles={noRoles} onChange={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByLabelText('Prompt')).toHaveValue('Decide bugfix or feature.')
  })

  it('lists every configured choice', () => {
    render(<RouterNodeFields node={routerNode()} roles={noRoles} onChange={vi.fn()} />)

    expect(screen.getByDisplayValue('bugfix')).toBeInTheDocument()
    expect(screen.getByDisplayValue('feature')).toBeInTheDocument()
  })

  it('adds a new empty choice', () => {
    const onChange = vi.fn()
    render(<RouterNodeFields node={routerNode()} roles={noRoles} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add choice' }))

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ choices: ['bugfix', 'feature', ''] })
    )
  })

  it('edits a choice label', () => {
    const onChange = vi.fn()
    render(<RouterNodeFields node={routerNode()} roles={noRoles} onChange={onChange} />)

    fireEvent.change(screen.getByDisplayValue('bugfix'), { target: { value: 'hotfix' } })

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ choices: ['hotfix', 'feature'] })
    )
  })

  it('removes a choice', () => {
    const onChange = vi.fn()
    render(<RouterNodeFields node={routerNode()} roles={noRoles} onChange={onChange} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove choice' })[0])

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ choices: ['feature'] }))
  })

  it('disables removing the last remaining choice', () => {
    render(
      <RouterNodeFields
        node={routerNode({ choices: ['bugfix'] })}
        roles={noRoles}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Remove choice' })).toBeDisabled()
  })

  it('flags duplicate choices with an inline error and aria-invalid on both rows', () => {
    render(
      <RouterNodeFields
        node={routerNode({ choices: ['bugfix', 'bugfix'] })}
        roles={noRoles}
        onChange={vi.fn()}
      />
    )

    expect(
      screen.getByText(
        'Choices must be non-empty and unique — a blank or repeated choice gets no outgoing edge.'
      )
    ).toBeInTheDocument()
    for (const input of screen.getAllByDisplayValue('bugfix')) {
      expect(input).toHaveAttribute('aria-invalid', 'true')
    }
  })

  it('flags a blank choice with an inline error', () => {
    render(
      <RouterNodeFields
        node={routerNode({ choices: ['bugfix', ''] })}
        roles={noRoles}
        onChange={vi.fn()}
      />
    )

    expect(
      screen.getByText(
        'Choices must be non-empty and unique — a blank or repeated choice gets no outgoing edge.'
      )
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('bugfix')).toHaveAttribute('aria-invalid', 'false')
  })

  it('shows no inline error once every choice is non-empty and unique', () => {
    render(<RouterNodeFields node={routerNode()} roles={noRoles} onChange={vi.fn()} />)

    expect(
      screen.queryByText(
        'Choices must be non-empty and unique — a blank or repeated choice gets no outgoing edge.'
      )
    ).not.toBeInTheDocument()
  })
})
