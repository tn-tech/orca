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

  describe('role selection (US4 AS2)', () => {
    const reviewer: Workflow['roles'] = {
      reviewer: {
        id: 'reviewer',
        name: 'Reviewer',
        agent: 'claude',
        systemPrompt: 'Review carefully.',
        skills: []
      }
    }

    it('assigns a role from the workflow roles', () => {
      const onChange = vi.fn()
      render(<RouterNodeFields node={routerNode()} roles={reviewer} onChange={onChange} />)

      fireEvent.click(screen.getByRole('combobox', { name: 'Role' }))
      fireEvent.click(screen.getByRole('option', { name: 'Reviewer' }))

      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ roleId: 'reviewer' }))
    })

    it('shows the role system prompt and reverts an override to the role default', () => {
      const onChange = vi.fn()
      render(
        <RouterNodeFields
          node={routerNode({ roleId: 'reviewer', overrides: { systemPrompt: 'Be terse.' } })}
          roles={reviewer}
          onChange={onChange}
        />
      )

      expect(screen.getByLabelText('System prompt')).toHaveValue('Be terse.')
      fireEvent.click(screen.getByRole('button', { name: 'Revert System prompt to role default' }))

      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ overrides: undefined }))
    })

    it('edits the system prompt as an override', () => {
      const onChange = vi.fn()
      render(
        <RouterNodeFields
          node={routerNode({ roleId: 'reviewer' })}
          roles={reviewer}
          onChange={onChange}
        />
      )

      fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Be brief.' } })

      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ overrides: { systemPrompt: 'Be brief.' } })
      )
    })
  })
})
