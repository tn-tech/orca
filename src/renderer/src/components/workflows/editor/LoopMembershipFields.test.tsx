// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  LoopNode,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import LoopMembershipFields from './LoopMembershipFields'

afterEach(() => {
  cleanup()
})

const loop: LoopNode = {
  id: 'loop',
  type: 'loop',
  title: 'QA loop',
  body: { nodeIds: ['impl', 'check', 'note'] },
  entryNodeId: 'impl',
  exitNodeId: 'check',
  maxIterations: 3,
  exitCondition: { path: 'option', op: 'eq', value: 'ok' },
  onCapReached: 'fail'
}

function agent(id: string, title: string): Node {
  return {
    id,
    type: 'agent',
    title,
    prompt: 'go',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1, escalationGraceMs: 1 }
  }
}

const definition: Workflow = {
  version: 1,
  name: 'test',
  workspacePolicy: 'run-workspace',
  roles: {},
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    loop,
    agent('impl', 'Implement'),
    {
      id: 'check',
      type: 'approval',
      title: 'Sign off',
      question: 'Good?',
      options: ['ok', 'redo'],
      timeoutMs: 1,
      escalationGraceMs: 1
    },
    agent('note', 'Take notes'),
    {
      id: 'gate',
      type: 'approval',
      title: 'Second look',
      question: 'Sure?',
      options: ['yes'],
      timeoutMs: 1,
      escalationGraceMs: 1
    },
    { id: 'end', type: 'end', title: 'End' }
  ],
  edges: [],
  layout: {}
}

function renderFields(onEditLoop = vi.fn()) {
  render(
    <TooltipProvider>
      <LoopMembershipFields node={loop} definition={definition} onEditLoop={onEditLoop} />
    </TooltipProvider>
  )
  return onEditLoop
}

describe('LoopMembershipFields (F11)', () => {
  it('shows the entry and exit nodes by title', () => {
    renderFields()
    expect(screen.getByRole('combobox', { name: 'Entry node' })).toHaveTextContent('Implement')
    expect(screen.getByRole('combobox', { name: 'Exit node' })).toHaveTextContent('Sign off')
  })

  it('repoints the entry node to another member', () => {
    const onEditLoop = renderFields()
    fireEvent.click(screen.getByRole('combobox', { name: 'Entry node' }))
    fireEvent.click(screen.getByRole('option', { name: 'Take notes' }))
    expect(onEditLoop).toHaveBeenCalledWith({ kind: 'set-entry', nodeId: 'note' })
  })

  it('repoints the exit node', () => {
    const onEditLoop = renderFields()
    fireEvent.click(screen.getByRole('combobox', { name: 'Exit node' }))
    fireEvent.click(screen.getByRole('option', { name: 'Implement' }))
    expect(onEditLoop).toHaveBeenCalledWith({ kind: 'set-exit', nodeId: 'impl' })
  })

  it('removes a member that is neither entry nor exit', () => {
    const onEditLoop = renderFields()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Take notes from the Loop' }))
    expect(onEditLoop).toHaveBeenCalledWith({ kind: 'remove-member', nodeId: 'note' })
  })

  it('keeps the entry and exit in the Loop, saying why', () => {
    const onEditLoop = renderFields()
    const removeEntry = screen.getByRole('button', { name: 'Remove Implement from the Loop' })
    expect(removeEntry).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(removeEntry)
    expect(onEditLoop).not.toHaveBeenCalled()
  })

  it('adds an Approval from outside the Loop', () => {
    const onEditLoop = renderFields()
    fireEvent.click(screen.getByRole('combobox', { name: 'Add a node to this Loop' }))
    expect(screen.queryByRole('option', { name: 'Start' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Second look' }))
    expect(onEditLoop).toHaveBeenCalledWith({ kind: 'add-member', nodeId: 'gate' })
  })
})
