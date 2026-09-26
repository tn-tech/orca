// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentNode, Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import AgentNodeFields from './AgentNodeFields'

afterEach(() => {
  cleanup()
})

function agentNode(patch: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'implement',
    type: 'agent',
    title: 'Implement',
    prompt: 'Build it.',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 },
    ...patch
  }
}

const noRoles: Workflow['roles'] = {}

describe('AgentNodeFields — model/effort disabled state (FR-004, US1 AS5)', () => {
  it('disables model and effort with a reason before any agent is chosen', () => {
    render(<AgentNodeFields node={agentNode()} roles={noRoles} onChange={vi.fn()} />)

    const model = screen.getByRole('combobox', { name: 'Model' })
    const effort = screen.getByRole('combobox', { name: 'Reasoning effort' })
    expect(model).toBeDisabled()
    expect(effort).toBeDisabled()
    expect(
      screen.getAllByText('Select an agent before choosing a model or reasoning effort.')
    ).toHaveLength(2)
  })

  it('disables model and effort with a reason for an agent that has no model catalog', () => {
    render(
      <AgentNodeFields
        node={agentNode({ overrides: { agent: 'aider' } })}
        roles={noRoles}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toBeDisabled()
    expect(
      screen.getAllByText(
        '"aider" has no model catalog, so model and reasoning effort cannot be overridden.'
      )
    ).toHaveLength(2)
  })

  it('enables model but keeps effort disabled until a model is chosen, for an agent with a catalog', () => {
    render(
      <AgentNodeFields
        node={agentNode({ overrides: { agent: 'claude' } })}
        roles={noRoles}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled()
    const effort = screen.getByRole('combobox', { name: 'Reasoning effort' })
    expect(effort).toBeDisabled()
    expect(screen.getByText('Select a model before choosing reasoning effort.')).toBeInTheDocument()
  })

  it('enables effort with the model’s choices once a model is chosen', () => {
    render(
      <AgentNodeFields
        node={agentNode({ overrides: { agent: 'claude', model: 'fable' } })}
        roles={noRoles}
        onChange={vi.fn()}
      />
    )

    const effort = screen.getByRole('combobox', { name: 'Reasoning effort' })
    expect(effort).toBeEnabled()

    fireEvent.click(effort)
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('resets the effort override when a different model is chosen', () => {
    const onChange = vi.fn()
    render(
      <AgentNodeFields
        node={agentNode({ overrides: { agent: 'claude', model: 'fable', effort: 'high' } })}
        roles={noRoles}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    fireEvent.click(screen.getByText('Opus'))

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ overrides: { agent: 'claude', model: 'opus' } })
    )
  })
})
