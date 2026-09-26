// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentNode,
  StartNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'

const { workflowCanvasMock } = vi.hoisted(() => ({ workflowCanvasMock: vi.fn() }))

vi.mock('../editor/WorkflowCanvas', () => ({
  default: (props: unknown) => {
    workflowCanvasMock(props)
    return <div data-testid="workflow-canvas-stub" />
  }
}))

import RunCanvasOverlay from './RunCanvasOverlay'

afterEach(() => {
  cleanup()
  workflowCanvasMock.mockClear()
})

function startNode(): StartNode {
  return { id: 'start', type: 'start', title: 'Start' }
}

function agentNode(id: string): AgentNode {
  return {
    id,
    type: 'agent',
    title: id,
    prompt: 'do it',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1, escalationGraceMs: 1 }
  }
}

function workflow(): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [startNode(), agentNode('implement'), agentNode('review')],
    edges: [
      { id: 'e1', from: 'start', to: 'implement' },
      { id: 'e2', from: 'implement', to: 'review' }
    ],
    layout: {}
  }
}

function snapshot(): WorkflowRunSnapshotView {
  return {
    id: 'run-1',
    workflowName: 'wf',
    workflowSource: 'project',
    workflowSnapshot: workflow(),
    workflowVersion: 'rev-1',
    objective: 'ship it',
    repoId: 'repo-1',
    state: 'running',
    concurrencyLimit: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    attempts: [
      {
        id: 'a1',
        runId: 'run-1',
        nodeId: 'implement',
        nodeType: 'agent',
        iteration: 0,
        attemptIndex: 0,
        state: 'completed',
        artifactsJson: []
      },
      {
        id: 'a2',
        runId: 'run-1',
        nodeId: 'review',
        nodeType: 'agent',
        iteration: 0,
        attemptIndex: 0,
        state: 'running',
        artifactsJson: []
      }
    ],
    questions: [],
    messages: [],
    events: []
  }
}

describe('RunCanvasOverlay', () => {
  it('paints each node with its latest attempt state', () => {
    render(<RunCanvasOverlay definition={workflow()} snapshot={snapshot()} />)

    expect(screen.getByTestId('workflow-canvas-stub')).toBeInTheDocument()
    expect(workflowCanvasMock).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeStatuses: { implement: 'completed', review: 'running' }
      })
    )
  })

  it('passes an empty status map without a run', () => {
    render(<RunCanvasOverlay definition={workflow()} snapshot={null} />)

    expect(workflowCanvasMock).toHaveBeenCalledWith(expect.objectContaining({ nodeStatuses: {} }))
  })

  it("passes each Loop node's active iteration", () => {
    const withLoop = snapshot()
    withLoop.attempts.push({
      id: 'a3',
      runId: 'run-1',
      nodeId: 'loop',
      nodeType: 'loop',
      iteration: 2,
      attemptIndex: 0,
      state: 'running',
      artifactsJson: []
    })

    render(<RunCanvasOverlay definition={workflow()} snapshot={withLoop} />)

    expect(workflowCanvasMock).toHaveBeenCalledWith(
      expect.objectContaining({ nodeIterations: { loop: 2 } })
    )
  })

  it('forwards canvas interaction props through', () => {
    const onNodeSelect = vi.fn()
    render(
      <RunCanvasOverlay
        definition={workflow()}
        snapshot={null}
        selectedNodeId="implement"
        onNodeSelect={onNodeSelect}
      />
    )

    expect(workflowCanvasMock).toHaveBeenCalledWith(
      expect.objectContaining({ selectedNodeId: 'implement', onNodeSelect })
    )
  })
})
