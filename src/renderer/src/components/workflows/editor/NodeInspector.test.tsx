// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  AgentNode,
  ApprovalNode,
  JoinNode,
  LoopNode,
  ReflectionNode,
  Role,
  RouterNode,
  StartNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import NodeInspector, { type NodeInspectorProps } from './NodeInspector'

afterEach(() => {
  cleanup()
})

function renderInspector(
  props: Partial<NodeInspectorProps> &
    Pick<NodeInspectorProps, 'definition' | 'onNodeChange' | 'onEdgeConditionChange'>
): void {
  render(
    <TooltipProvider>
      <NodeInspector onSetRole={vi.fn()} onRemoveRole={vi.fn()} {...props} />
    </TooltipProvider>
  )
}

function role(patch: Partial<Role> = {}): Role {
  return {
    id: 'reviewer',
    name: 'Reviewer',
    agent: 'claude',
    systemPrompt: 'Review the change.',
    skills: [],
    ...patch
  }
}

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

function startNode(): StartNode {
  return { id: 'start', type: 'start', title: 'Start' }
}

function loopNode(patch: Partial<LoopNode> = {}): LoopNode {
  return {
    id: 'loop',
    type: 'loop',
    title: 'Loop',
    body: { nodeIds: ['implement'] },
    entryNodeId: 'implement',
    exitNodeId: 'implement',
    maxIterations: 0,
    exitCondition: { path: 'approved', op: 'truthy' },
    onCapReached: 'fail',
    ...patch
  }
}

function joinNode(patch: Partial<JoinNode> = {}): JoinNode {
  return { id: 'join', type: 'join', title: 'Join', policy: 'all', onFailure: 'fail', ...patch }
}

function routerNode(patch: Partial<RouterNode> = {}): RouterNode {
  return {
    id: 'router',
    type: 'router',
    title: 'Router',
    prompt: 'Decide.',
    choices: ['bugfix', 'feature'],
    ...patch
  }
}

function reflectionNode(patch: Partial<ReflectionNode> = {}): ReflectionNode {
  return {
    id: 'reflect',
    type: 'reflection',
    title: 'Reflect',
    prompt: 'Review the run and propose role improvements.',
    ...patch
  }
}

function approvalNode(patch: Partial<ApprovalNode> = {}): ApprovalNode {
  return {
    id: 'approval',
    type: 'approval',
    title: 'Approve the plan',
    question: 'Approve the plan?',
    options: ['Approve', 'Reject'],
    timeoutMs: 3_600_000,
    escalationGraceMs: 1_800_000,
    ...patch
  }
}

function workflow(patch: Partial<Workflow> = {}): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [startNode(), agentNode()],
    edges: [{ id: 'edge-1', from: 'start', to: 'implement' }],
    layout: {},
    ...patch
  }
}

describe('NodeInspector', () => {
  it('shows the workflow-level Roles panel with nothing selected (US4 AS1)', () => {
    render(
      <NodeInspector
        definition={workflow()}
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument()
    expect(
      screen.getByText('No roles yet. Create one or import from a repository.')
    ).toBeInTheDocument()
  })

  it('renders AgentNodeFields for a selected agent node', () => {
    render(
      <NodeInspector
        definition={workflow()}
        selectedNodeId="implement"
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )
    expect(screen.getByDisplayValue('Implement')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
    // Title/Prompt are plain Input/Textarea fields; the shadcn Label must be programmatically
    // associated with them (htmlFor/id) for screen readers, not just a nearby caption div.
    expect(screen.getByLabelText('Title')).toHaveValue('Implement')
    expect(screen.getByLabelText('Prompt')).toHaveValue('Build it.')
  })

  it('shows title/notes but not AgentNodeFields for a non-agent node', () => {
    render(
      <NodeInspector
        definition={workflow()}
        selectedNodeId="start"
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )
    expect(screen.getByDisplayValue('Start')).toBeInTheDocument()
    expect(
      screen.getByText('Detailed settings for this node type land in a later unit.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Model' })).not.toBeInTheDocument()
  })

  it('edits a non-agent node title through the shared base fields', () => {
    const onNodeChange = vi.fn()
    render(
      <NodeInspector
        definition={workflow()}
        selectedNodeId="start"
        onNodeChange={onNodeChange}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )

    fireEvent.change(screen.getByDisplayValue('Start'), { target: { value: 'Kickoff' } })

    expect(onNodeChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'start', type: 'start', title: 'Kickoff' })
    )
  })

  it('renders LoopNodeFields for a selected loop node, flagging a missing max-iterations cap', () => {
    render(
      <NodeInspector
        definition={workflow({ nodes: [startNode(), loopNode()] })}
        selectedNodeId="loop"
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Maximum iterations')).toHaveValue(null)
    expect(
      screen.getByText('Every loop needs a maximum iteration count before it can be saved.')
    ).toBeInTheDocument()
  })

  it('sets a loop node maximum iteration count', () => {
    const onNodeChange = vi.fn()
    render(
      <NodeInspector
        definition={workflow({ nodes: [startNode(), loopNode()] })}
        selectedNodeId="loop"
        onNodeChange={onNodeChange}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('Maximum iterations'), { target: { value: '3' } })

    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ maxIterations: 3 }))
  })

  it('renders JoinNodeFields for a selected join node, with its incoming edge count', () => {
    render(
      <NodeInspector
        definition={workflow({
          nodes: [startNode(), agentNode(), joinNode()],
          edges: [
            { id: 'edge-1', from: 'start', to: 'implement' },
            { id: 'edge-2', from: 'implement', to: 'join' }
          ]
        })}
        selectedNodeId="join"
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )
    expect(screen.getByRole('combobox', { name: 'Policy' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'When a branch fails' })).toBeInTheDocument()
  })

  it('renders RouterNodeFields for a selected router node', () => {
    render(
      <NodeInspector
        definition={workflow({ nodes: [startNode(), routerNode()] })}
        selectedNodeId="router"
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('bugfix')).toBeInTheDocument()
    expect(screen.getByDisplayValue('feature')).toBeInTheDocument()
  })

  it('renders ReflectionNodeFields for a selected reflection node (US7)', () => {
    render(
      <NodeInspector
        definition={workflow({ nodes: [startNode(), reflectionNode()] })}
        selectedNodeId="reflect"
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByLabelText('Prompt')).toHaveValue(
      'Review the run and propose role improvements.'
    )
    expect(
      screen.queryByText('Detailed settings for this node type land in a later unit.')
    ).not.toBeInTheDocument()
  })

  it('renders ApprovalNodeFields for a selected approval node', () => {
    render(
      <NodeInspector
        definition={workflow({ nodes: [startNode(), approvalNode()] })}
        selectedNodeId="approval"
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Question')).toHaveValue('Approve the plan?')
    expect(screen.getByDisplayValue('Approve')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Reject')).toBeInTheDocument()
  })

  it('renders ConditionBuilder for a selected edge', () => {
    render(
      <NodeInspector
        definition={workflow()}
        selectedEdgeId="edge-1"
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
        onSetRole={vi.fn()}
        onRemoveRole={vi.fn()}
      />
    )
    expect(screen.getByText('start → implement')).toBeInTheDocument()
    expect(screen.getByText('No condition — this edge always fires.')).toBeInTheDocument()
  })

  describe('Agent node role assignment and overrides (FR-017, FR-020)', () => {
    it('lists roles from the definition and assigns one to the node', () => {
      const onNodeChange = vi.fn()
      renderInspector({
        definition: workflow({ roles: { reviewer: role() } }),
        selectedNodeId: 'implement',
        onNodeChange,
        onEdgeConditionChange: vi.fn()
      })

      fireEvent.click(screen.getByRole('combobox', { name: 'Role' }))
      fireEvent.click(screen.getByRole('option', { name: 'Reviewer' }))

      expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ roleId: 'reviewer' }))
    })

    it('shows no "Role overrides" strip until a field actually diverges from the role', () => {
      renderInspector({
        definition: workflow({
          nodes: [
            { id: 'start', type: 'start', title: 'Start' },
            agentNode({ roleId: 'reviewer' })
          ],
          roles: { reviewer: role() }
        }),
        selectedNodeId: 'implement',
        onNodeChange: vi.fn(),
        onEdgeConditionChange: vi.fn()
      })

      expect(screen.queryByText('Role overrides')).not.toBeInTheDocument()
    })

    it('shows an overridden field distinctly and reverts it back to the role default', () => {
      const onNodeChange = vi.fn()
      renderInspector({
        definition: workflow({
          nodes: [
            { id: 'start', type: 'start', title: 'Start' },
            agentNode({ roleId: 'reviewer', overrides: { systemPrompt: 'Be terse.' } })
          ],
          roles: { reviewer: role() }
        }),
        selectedNodeId: 'implement',
        onNodeChange,
        onEdgeConditionChange: vi.fn()
      })

      expect(screen.getByText('Role overrides')).toBeInTheDocument()
      expect(screen.getByLabelText('System prompt')).toHaveValue('Be terse.')

      fireEvent.click(screen.getByRole('button', { name: 'Revert System prompt to role default' }))

      expect(onNodeChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ overrides: undefined })
      )
    })

    it('warns when the effective agent has no documented workspace skill location', () => {
      renderInspector({
        definition: workflow({
          nodes: [
            { id: 'start', type: 'start', title: 'Start' },
            agentNode({
              roleId: 'reviewer',
              overrides: {
                skills: [
                  { name: 'plan', source: { kind: 'plugin', plugin: 'speckit' }, required: true }
                ]
              }
            })
          ],
          roles: { reviewer: role({ agent: 'amp' }) }
        }),
        selectedNodeId: 'implement',
        onNodeChange: vi.fn(),
        onEdgeConditionChange: vi.fn()
      })

      expect(
        screen.getByText(
          `"amp" can't load skills from a workspace; skill instructions will be included in the prompt instead.`
        )
      ).toBeInTheDocument()
    })

    it('does not warn when the effective agent has a documented workspace skill location', () => {
      renderInspector({
        definition: workflow({
          nodes: [
            { id: 'start', type: 'start', title: 'Start' },
            agentNode({
              roleId: 'reviewer',
              overrides: {
                skills: [
                  { name: 'plan', source: { kind: 'plugin', plugin: 'speckit' }, required: true }
                ]
              }
            })
          ],
          roles: { reviewer: role({ agent: 'claude' }) }
        }),
        selectedNodeId: 'implement',
        onNodeChange: vi.fn(),
        onEdgeConditionChange: vi.fn()
      })

      expect(screen.queryByText(/can't load skills from a workspace/)).not.toBeInTheDocument()
    })

    it('threads allowlistedSources through to the skills list on an Agent node', () => {
      renderInspector({
        definition: workflow({
          nodes: [
            { id: 'start', type: 'start', title: 'Start' },
            agentNode({
              overrides: {
                skills: [
                  {
                    name: 'plan',
                    source: { kind: 'repository', location: 'https://example.com/not-allowlisted' },
                    required: true
                  }
                ]
              }
            })
          ]
        }),
        selectedNodeId: 'implement',
        onNodeChange: vi.fn(),
        onEdgeConditionChange: vi.fn(),
        allowlistedSources: ['https://example.com/allowed']
      })

      expect(screen.getByText('https://example.com/not-allowlisted')).toBeInTheDocument()
    })
  })

  describe('Roles panel wiring (US4 AS1)', () => {
    it('creates a role from the empty state through onSetRole', async () => {
      const user = userEvent.setup()
      const onSetRole = vi.fn()
      renderInspector({
        definition: workflow(),
        onNodeChange: vi.fn(),
        onEdgeConditionChange: vi.fn(),
        onSetRole
      })

      await user.click(screen.getByRole('button', { name: 'Add role' }))
      await user.click(screen.getByRole('menuitem', { name: 'New role' }))
      fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'dev' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dev' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))

      expect(onSetRole).toHaveBeenCalledWith('dev', {
        id: 'dev',
        name: 'Dev',
        agent: '',
        systemPrompt: '',
        skills: []
      })
    })

    it('removes a role through onRemoveRole', () => {
      const onRemoveRole = vi.fn()
      renderInspector({
        definition: workflow({ roles: { reviewer: role() } }),
        onNodeChange: vi.fn(),
        onEdgeConditionChange: vi.fn(),
        onRemoveRole
      })

      fireEvent.click(screen.getByRole('button', { name: 'Remove role' }))

      expect(onRemoveRole).toHaveBeenCalledWith('reviewer')
    })
  })

  describe('Delete and Unwrap (F4)', () => {
    it('has no delete control when no handler is wired', () => {
      render(
        <NodeInspector
          definition={workflow()}
          selectedNodeId="implement"
          onNodeChange={vi.fn()}
          onEdgeConditionChange={vi.fn()}
          onSetRole={vi.fn()}
          onRemoveRole={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
    })

    it('deletes the selected node through onDeleteNode', () => {
      const onDeleteNode = vi.fn()
      render(
        <NodeInspector
          definition={workflow()}
          selectedNodeId="implement"
          onNodeChange={vi.fn()}
          onEdgeConditionChange={vi.fn()}
          onSetRole={vi.fn()}
          onRemoveRole={vi.fn()}
          onDeleteNode={onDeleteNode}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Delete node' }))

      expect(onDeleteNode).toHaveBeenCalledWith('implement')
    })

    it('never disables the node delete button itself (F4 review round 1, Minor #3 — Delete follows the same rule as every other edit)', () => {
      render(
        <NodeInspector
          definition={workflow()}
          selectedNodeId="implement"
          onNodeChange={vi.fn()}
          onEdgeConditionChange={vi.fn()}
          onSetRole={vi.fn()}
          onRemoveRole={vi.fn()}
          onDeleteNode={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: 'Delete node' })).not.toBeDisabled()
    })

    it('deletes the selected edge through onDeleteEdge', () => {
      const onDeleteEdge = vi.fn()
      render(
        <NodeInspector
          definition={workflow()}
          selectedEdgeId="edge-1"
          onNodeChange={vi.fn()}
          onEdgeConditionChange={vi.fn()}
          onSetRole={vi.fn()}
          onRemoveRole={vi.fn()}
          onDeleteEdge={onDeleteEdge}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Delete edge' }))

      expect(onDeleteEdge).toHaveBeenCalledWith('edge-1')
    })

    it('shows Unwrap and "Delete Loop" for a selected Loop node, and calls each handler', () => {
      const onDeleteNode = vi.fn()
      const onUnwrapLoop = vi.fn()
      render(
        <NodeInspector
          definition={workflow({ nodes: [startNode(), loopNode()] })}
          selectedNodeId="loop"
          onNodeChange={vi.fn()}
          onEdgeConditionChange={vi.fn()}
          onSetRole={vi.fn()}
          onRemoveRole={vi.fn()}
          onDeleteNode={onDeleteNode}
          onUnwrapLoop={onUnwrapLoop}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Unwrap' }))
      expect(onUnwrapLoop).toHaveBeenCalledWith('loop')

      fireEvent.click(screen.getByRole('button', { name: 'Delete Loop' }))
      expect(onDeleteNode).toHaveBeenCalledWith('loop')
    })

    it('does not offer Unwrap for a non-Loop node', () => {
      render(
        <NodeInspector
          definition={workflow()}
          selectedNodeId="implement"
          onNodeChange={vi.fn()}
          onEdgeConditionChange={vi.fn()}
          onSetRole={vi.fn()}
          onRemoveRole={vi.fn()}
          onDeleteNode={vi.fn()}
          onUnwrapLoop={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Unwrap' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete node' })).toBeInTheDocument()
    })
  })
})
