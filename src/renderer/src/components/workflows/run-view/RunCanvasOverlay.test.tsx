// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentNode,
  LoopNode,
  StartNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'

const { workflowCanvasMock, useWorktreeMapMock } = vi.hoisted(() => ({
  workflowCanvasMock: vi.fn(),
  useWorktreeMapMock: vi.fn()
}))

vi.mock('../editor/WorkflowCanvas', () => ({
  default: (props: unknown) => {
    workflowCanvasMock(props)
    return <div data-testid="workflow-canvas-stub" />
  }
}))

vi.mock('@/store/selectors', () => ({ useWorktreeMap: useWorktreeMapMock }))

import RunCanvasOverlay from './RunCanvasOverlay'

beforeEach(() => {
  useWorktreeMapMock.mockReturnValue(new Map())
})

afterEach(() => {
  cleanup()
  workflowCanvasMock.mockClear()
  useWorktreeMapMock.mockReset()
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

function loopNode(): LoopNode {
  return {
    id: 'loop',
    type: 'loop',
    title: 'Loop',
    body: { nodeIds: ['implement', 'review'] },
    entryNodeId: 'implement',
    exitNodeId: 'review',
    maxIterations: 3,
    exitCondition: { path: 'approved', op: 'truthy' },
    onCapReached: 'fail'
  }
}

function workflowWithLoop(): Workflow {
  return {
    ...workflow(),
    nodes: [startNode(), loopNode(), agentNode('implement'), agentNode('review')]
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

  it("passes each Loop node's active iteration, read from its body nodes (review round 2)", () => {
    // Shaped like the engine's actual attempts: the Loop's own attempt is stuck at iteration 0,
    // while its body nodes (implement/review) carry real per-iteration attempts (0, 1, 2).
    const withLoop = snapshot()
    withLoop.workflowSnapshot = workflowWithLoop()
    withLoop.attempts.push(
      {
        id: 'a3',
        runId: 'run-1',
        nodeId: 'loop',
        nodeType: 'loop',
        iteration: 0,
        attemptIndex: 0,
        state: 'running',
        artifactsJson: []
      },
      {
        id: 'a4',
        runId: 'run-1',
        nodeId: 'implement',
        nodeType: 'agent',
        iteration: 1,
        attemptIndex: 0,
        state: 'completed',
        artifactsJson: []
      },
      {
        id: 'a5',
        runId: 'run-1',
        nodeId: 'review',
        nodeType: 'agent',
        iteration: 1,
        attemptIndex: 0,
        state: 'running',
        artifactsJson: []
      }
    )

    render(<RunCanvasOverlay definition={workflowWithLoop()} snapshot={withLoop} />)

    // Highest body iteration seen is index 1 (a second pass) -> displayed as "2".
    expect(workflowCanvasMock).toHaveBeenCalledWith(
      expect.objectContaining({ nodeIterations: { loop: 2 } })
    )
  })

  it("resolves each node's workspaceWorktreeId to the worktree's display name", () => {
    useWorktreeMapMock.mockReturnValue(
      new Map([['wt-1', { id: 'wt-1', displayName: 'implement-child' }]])
    )
    const withWorkspace = snapshot()
    withWorkspace.attempts[0].workspaceWorktreeId = 'wt-1'

    render(<RunCanvasOverlay definition={workflow()} snapshot={withWorkspace} />)

    expect(workflowCanvasMock).toHaveBeenCalledWith(
      expect.objectContaining({ nodeWorkspaces: { implement: 'implement-child' } })
    )
  })

  it('falls back to the raw worktree id when the worktree is not (yet) known to this client', () => {
    const withWorkspace = snapshot()
    withWorkspace.attempts[0].workspaceWorktreeId = 'wt-unknown'

    render(<RunCanvasOverlay definition={workflow()} snapshot={withWorkspace} />)

    expect(workflowCanvasMock).toHaveBeenCalledWith(
      expect.objectContaining({ nodeWorkspaces: { implement: 'wt-unknown' } })
    )
  })

  it('passes an empty workspace map without a run', () => {
    render(<RunCanvasOverlay definition={workflow()} snapshot={null} />)

    expect(workflowCanvasMock).toHaveBeenCalledWith(expect.objectContaining({ nodeWorkspaces: {} }))
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
