// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ReflectionNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import ReflectionNodeFields from './ReflectionNodeFields'

afterEach(() => {
  cleanup()
})

function reflectionNode(patch: Partial<ReflectionNode> = {}): ReflectionNode {
  return {
    id: 'reflect',
    type: 'reflection',
    title: 'Reflect',
    prompt: 'Review the run and propose role improvements.',
    ...patch
  }
}

const noRoles: Workflow['roles'] = {}

describe('ReflectionNodeFields (US7, data-model.md §1 roleDispatchFields)', () => {
  it('renders the shared role/model/prompt fields', () => {
    render(<ReflectionNodeFields node={reflectionNode()} roles={noRoles} onChange={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByLabelText('Prompt')).toHaveValue(
      'Review the run and propose role improvements.'
    )
  })

  it('does not offer a result-contract editor (Reflection has a fixed result contract)', () => {
    render(<ReflectionNodeFields node={reflectionNode()} roles={noRoles} onChange={vi.fn()} />)

    expect(screen.queryByText(/result contract/i)).not.toBeInTheDocument()
  })

  it('edits the prompt', () => {
    const onChange = vi.fn()
    render(<ReflectionNodeFields node={reflectionNode()} roles={noRoles} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'New prompt.' } })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'New prompt.' }))
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
      render(<ReflectionNodeFields node={reflectionNode()} roles={reviewer} onChange={onChange} />)

      fireEvent.click(screen.getByRole('combobox', { name: 'Role' }))
      fireEvent.click(screen.getByRole('option', { name: 'Reviewer' }))

      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ roleId: 'reviewer' }))
    })

    it('shows the role system prompt and reverts an override to the role default', () => {
      const onChange = vi.fn()
      render(
        <ReflectionNodeFields
          node={reflectionNode({ roleId: 'reviewer', overrides: { systemPrompt: 'Be terse.' } })}
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
        <ReflectionNodeFields
          node={reflectionNode({ roleId: 'reviewer' })}
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
