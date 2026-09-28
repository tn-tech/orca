// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentNode,
  EndNode,
  LoopNode,
  StartNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import {
  createInitialWorkflowEditorState,
  workflowEditorReducer
} from './use-workflow-editor-state'
import WrapInLoopButton from './WrapInLoopButton'

afterEach(() => {
  cleanup()
})

function startNode(id = 'start'): StartNode {
  return { id, type: 'start', title: 'Start' }
}

function endNode(id = 'end'): EndNode {
  return { id, type: 'end', title: 'End' }
}

function agentNode(id: string, patch: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    type: 'agent',
    title: id,
    prompt: 'go',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 },
    ...patch
  }
}

function emptyWorkflow(): Workflow {
  return {
    version: 1,
    name: 'test-workflow',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [],
    edges: [],
    layout: {}
  }
}

describe('WrapInLoopButton', () => {
  it('is disabled when nothing is selected', () => {
    render(<WrapInLoopButton selectedNodeIds={[]} onWrapInLoop={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Wrap in Loop' })).toBeDisabled()
  })

  it('is enabled and dispatches wrap-in-loop for the current selection when clicked', () => {
    const onWrapInLoop = vi.fn()
    render(<WrapInLoopButton selectedNodeIds={['agent-1']} onWrapInLoop={onWrapInLoop} />)

    const button = screen.getByRole('button', { name: 'Wrap in Loop' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)

    expect(onWrapInLoop).toHaveBeenCalledWith(['agent-1'])
  })

  it('wraps the selected node into a Loop that contains it, through the real reducer', () => {
    let state = createInitialWorkflowEditorState(emptyWorkflow())
    state = workflowEditorReducer(state, {
      type: 'add-node',
      node: startNode(),
      position: { x: 0, y: 0 }
    })
    state = workflowEditorReducer(state, {
      type: 'add-node',
      node: agentNode('a'),
      position: { x: 200, y: 0 }
    })
    state = workflowEditorReducer(state, {
      type: 'add-node',
      node: endNode(),
      position: { x: 400, y: 0 }
    })
    state = workflowEditorReducer(state, { type: 'connect', from: 'start', to: 'a' })
    state = workflowEditorReducer(state, { type: 'connect', from: 'a', to: 'end' })

    render(
      <WrapInLoopButton
        selectedNodeIds={['a']}
        onWrapInLoop={(nodeIds) => {
          state = workflowEditorReducer(state, { type: 'wrap-in-loop', nodeIds })
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Wrap in Loop' }))

    const loop = state.definition.nodes.find((node): node is LoopNode => node.type === 'loop')
    expect(loop).toBeDefined()
    expect(loop?.body.nodeIds).toEqual(['a'])
  })
})
