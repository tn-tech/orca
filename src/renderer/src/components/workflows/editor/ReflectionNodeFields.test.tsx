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

describe('ReflectionNodeFields (US7, data-model.md §1 roleDispatchShape)', () => {
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
})
