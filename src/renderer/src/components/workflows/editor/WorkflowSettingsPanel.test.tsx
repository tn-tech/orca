// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import WorkflowSettingsPanel from './WorkflowSettingsPanel'
import { workflowEditorReducer, createInitialWorkflowEditorState } from './use-workflow-editor-state'

afterEach(() => {
  cleanup()
})

function definition(patch: Partial<Workflow> = {}): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
    layout: {},
    roles: {},
    ...patch
  }
}

describe('WorkflowSettingsPanel (F13)', () => {
  it('switches the workspace policy', () => {
    const onChange = vi.fn()
    render(<WorkflowSettingsPanel definition={definition()} onChange={onChange} />)
    expect(screen.getByRole('radio', { name: 'Run workspace' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'In place' }))
    expect(onChange).toHaveBeenCalledWith({ workspacePolicy: 'in-place' })
  })

  it('explains the selected policy', () => {
    render(
      <WorkflowSettingsPanel
        definition={definition({ workspacePolicy: 'in-place' })}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText(/work directly in the project folder/)).toBeInTheDocument()
  })

  it('explains that folder workspaces have no child workspaces', () => {
    render(<WorkflowSettingsPanel definition={definition()} isFolderWorkspace onChange={vi.fn()} />)
    expect(screen.getByText(/folder without version control/)).toBeInTheDocument()
  })

  it('warns when in-place meets child-workspace nodes', () => {
    const wf = definition({
      workspacePolicy: 'in-place',
      nodes: [
        {
          id: 'a',
          type: 'agent',
          title: 'A',
          prompt: 'x',
          workspace: 'child',
          resultContract: { type: 'object' },
          artifacts: [],
          question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
        }
      ]
    })
    render(<WorkflowSettingsPanel definition={wf} onChange={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('1 agent node(s)')
  })

  it('commits a valid concurrency limit, clears on blank, and rejects invalid text', () => {
    const onChange = vi.fn()
    render(<WorkflowSettingsPanel definition={definition({ concurrencyLimit: 2 })} onChange={onChange} />)
    const input = screen.getByLabelText('Concurrency limit')
    expect(input).toHaveValue(2)
    fireEvent.change(input, { target: { value: '6' } })
    expect(onChange).toHaveBeenLastCalledWith({ concurrencyLimit: 6 })
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ concurrencyLimit: undefined })
    onChange.mockClear()
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a whole number of at least 1.')).toBeInTheDocument()
  })

  it('shows the default as a placeholder when unset', () => {
    render(<WorkflowSettingsPanel definition={definition()} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Concurrency limit')).toHaveAttribute('placeholder', '4')
  })
})

describe('update-settings reducer action (F13)', () => {
  it('sets policy and limit as undoable edits, and drops a cleared limit', () => {
    let state = createInitialWorkflowEditorState(definition())
    state = workflowEditorReducer(state, {
      type: 'update-settings',
      patch: { workspacePolicy: 'in-place', concurrencyLimit: 3 }
    })
    expect(state.definition.workspacePolicy).toBe('in-place')
    expect(state.definition.concurrencyLimit).toBe(3)
    expect(state.dirty).toBe(true)
    state = workflowEditorReducer(state, {
      type: 'update-settings',
      patch: { concurrencyLimit: undefined }
    })
    expect('concurrencyLimit' in state.definition).toBe(false)
    expect(state.definition.workspacePolicy).toBe('in-place')
    state = workflowEditorReducer(state, { type: 'undo' })
    expect(state.definition.concurrencyLimit).toBe(3)
  })

  it('round-trips through the workflow file schema', async () => {
    const { WorkflowFileSchema } = await import(
      '../../../../../shared/workflows/workflow-definition-schema'
    )
    const state = workflowEditorReducer(createInitialWorkflowEditorState(definition()), {
      type: 'update-settings',
      patch: { workspacePolicy: 'in-place', concurrencyLimit: 7 }
    })
    const parsed = WorkflowFileSchema.parse(JSON.parse(JSON.stringify(state.definition)))
    expect(parsed.workspacePolicy).toBe('in-place')
    expect(parsed.concurrencyLimit).toBe(7)
    const legacy = definition()
    expect(WorkflowFileSchema.parse(legacy).concurrencyLimit).toBeUndefined()
  })
})
