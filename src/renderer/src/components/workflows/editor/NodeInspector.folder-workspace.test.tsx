// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import NodeInspector from './NodeInspector'

afterEach(() => {
  cleanup()
})

const definition: Workflow = {
  version: 1,
  name: 'wf',
  workspacePolicy: 'run-workspace',
  roles: {},
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    {
      id: 'implement',
      type: 'agent',
      title: 'Implement',
      prompt: 'Build it.',
      workspace: 'run',
      resultContract: { type: 'object' },
      artifacts: [],
      question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
    }
  ],
  edges: [{ id: 'e1', from: 'start', to: 'implement' }],
  layout: {}
}

function renderInspector(isFolderWorkspace: boolean, onNodeChange = vi.fn()) {
  render(
    <TooltipProvider>
      <NodeInspector
        definition={definition}
        selectedNodeId="implement"
        isFolderWorkspace={isFolderWorkspace}
        onNodeChange={onNodeChange}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    </TooltipProvider>
  )
  return onNodeChange
}

describe('NodeInspector agent workspace in a folder repo (FR-041)', () => {
  it('disables Child workspace with its reason', () => {
    const onNodeChange = renderInspector(true)
    const child = screen.getByRole('radio', { name: 'Child workspace' })
    expect(child).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(child)
    expect(onNodeChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Folder workspaces have no worktrees/)).toBeInTheDocument()
  })

  it('keeps Child workspace selectable in a git repo', () => {
    const onNodeChange = renderInspector(false)
    fireEvent.click(screen.getByRole('radio', { name: 'Child workspace' }))
    expect(onNodeChange).toHaveBeenCalledWith(expect.objectContaining({ workspace: 'child' }))
  })
})
