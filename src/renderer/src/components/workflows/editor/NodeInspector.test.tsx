// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentNode,
  StartNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import NodeInspector from './NodeInspector'

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

function startNode(): StartNode {
  return { id: 'start', type: 'start', title: 'Start' }
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
  it('shows an empty state with nothing selected', () => {
    render(
      <NodeInspector
        definition={workflow()}
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
      />
    )
    expect(screen.getByText('Select a node or edge to edit its settings.')).toBeInTheDocument()
  })

  it('renders AgentNodeFields for a selected agent node', () => {
    render(
      <NodeInspector
        definition={workflow()}
        selectedNodeId="implement"
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
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
      />
    )

    fireEvent.change(screen.getByDisplayValue('Start'), { target: { value: 'Kickoff' } })

    expect(onNodeChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'start', type: 'start', title: 'Kickoff' })
    )
  })

  it('renders ConditionBuilder for a selected edge', () => {
    render(
      <NodeInspector
        definition={workflow()}
        selectedEdgeId="edge-1"
        onNodeChange={vi.fn()}
        onEdgeConditionChange={vi.fn()}
      />
    )
    expect(screen.getByText('start → implement')).toBeInTheDocument()
    expect(screen.getByText('No condition — this edge always fires.')).toBeInTheDocument()
  })
})
