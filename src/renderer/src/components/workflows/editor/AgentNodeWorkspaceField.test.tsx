// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AgentNode } from '../../../../../shared/workflows/workflow-definition-types'
import AgentNodeWorkspaceField from './AgentNodeWorkspaceField'

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

function renderField(node: AgentNode, isFolderWorkspace: boolean, onChange = vi.fn()) {
  render(
    <TooltipProvider>
      <AgentNodeWorkspaceField
        node={node}
        isFolderWorkspace={isFolderWorkspace}
        onChange={onChange}
      />
    </TooltipProvider>
  )
  return onChange
}

describe('AgentNodeWorkspaceField (FR-041)', () => {
  it('lets a git repo pick either workspace', () => {
    const onChange = renderField(agentNode(), false)
    fireEvent.click(screen.getByRole('radio', { name: 'Child workspace' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ workspace: 'child' }))
  })

  it('disables Child workspace in a folder repo, with a reason', () => {
    const onChange = renderField(agentNode(), true)
    const child = screen.getByRole('radio', { name: 'Child workspace' })
    expect(child).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(child)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Folder workspaces have no worktrees/)).toBeInTheDocument()
  })

  it('still shows an existing child choice in a folder repo so validation can flag it', () => {
    renderField(agentNode({ workspace: 'child' }), true)
    expect(screen.getByRole('radio', { name: 'Child workspace' })).toBeChecked()
  })
})
