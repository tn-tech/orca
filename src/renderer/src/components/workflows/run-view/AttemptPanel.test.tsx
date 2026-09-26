// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentNode,
  StartNode,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../../../shared/workflows/workflow-run-types'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'

const { focusTaskMock, focusHandleMock, openAllDiffsMock, useWorktreeByIdMock, toastErrorMock } =
  vi.hoisted(() => ({
    focusTaskMock: vi.fn(),
    focusHandleMock: vi.fn(),
    openAllDiffsMock: vi.fn(),
    useWorktreeByIdMock: vi.fn(),
    toastErrorMock: vi.fn()
  }))

vi.mock('@/components/terminal-pane/terminal-orchestration-task-links', () => ({
  focusRuntimeOrchestrationTask: focusTaskMock
}))
vi.mock('@/components/terminal-pane/terminal-handle-links', () => ({
  focusRendererTerminalHandle: focusHandleMock
}))
vi.mock('@/store/selectors', () => ({
  useWorktreeById: useWorktreeByIdMock
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { openAllDiffs: typeof openAllDiffsMock }) => unknown) =>
    selector({ openAllDiffs: openAllDiffsMock })
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

import AttemptPanel from './AttemptPanel'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  useWorktreeByIdMock.mockReturnValue(null)
  focusTaskMock.mockResolvedValue(undefined)
})

function startNode(): StartNode {
  return { id: 'start', type: 'start', title: 'Start' }
}

function agentNode(): AgentNode {
  return {
    id: 'implement',
    type: 'agent',
    title: 'Implement',
    prompt: 'Build it.',
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
    nodes: [startNode(), agentNode()],
    edges: [{ id: 'e1', from: 'start', to: 'implement' }],
    layout: {}
  }
}

function attempt(patch: Partial<NodeAttemptView> = {}): NodeAttemptView {
  return {
    id: 'attempt-1',
    runId: 'run-1',
    nodeId: 'implement',
    nodeType: 'agent',
    iteration: 0,
    attemptIndex: 0,
    state: 'completed',
    artifactsJson: [],
    ...patch
  }
}

function snapshot(attempts: NodeAttemptView[]): WorkflowRunSnapshotView {
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
    attempts,
    questions: [],
    messages: [],
    events: []
  }
}

describe('AttemptPanel', () => {
  it('shows a not-started state when the node has no attempt yet', () => {
    render(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([])}
        nodeId="implement"
        runtimeEnvironmentId={null}
      />
    )

    expect(screen.getByText('Implement')).toBeInTheDocument()
    expect(screen.getByText("This node hasn't run yet.")).toBeInTheDocument()
  })

  it('shows requested vs effective launch and the result', () => {
    render(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([
          attempt({
            requestedLaunch: { agent: 'claude-code', model: 'opus', effort: 'high' },
            effectiveLaunch: { agent: 'claude-code', model: 'opus-4', effort: 'high' },
            resultJson: { summary: 'done' }
          })
        ])}
        nodeId="implement"
        runtimeEnvironmentId={null}
      />
    )

    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getAllByText('claude-code')).toHaveLength(2)
    expect(screen.getByText('opus · high')).toBeInTheDocument()
    expect(screen.getByText('opus-4 · high')).toBeInTheDocument()
    expect(screen.getByText(/"summary": "done"/)).toBeInTheDocument()
  })

  it('shows the failure reason for a failed attempt', () => {
    render(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([attempt({ state: 'failed', failureReason: 'agent crashed' })])}
        nodeId="implement"
        runtimeEnvironmentId={null}
      />
    )

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('agent crashed')).toBeInTheDocument()
  })

  it('lists artifacts and flags a missing one', () => {
    render(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([
          attempt({
            artifactsJson: [
              { path: 'out/report.csv', exists: true },
              { path: 'out/missing.csv', exists: false }
            ]
          })
        ])}
        nodeId="implement"
        runtimeEnvironmentId={null}
      />
    )

    expect(screen.getByText('out/report.csv')).toBeInTheDocument()
    expect(screen.getByText('out/missing.csv')).toBeInTheDocument()
  })

  it('disables Open transcript without a task id, and focuses it via the orchestration link when present', () => {
    const { rerender } = render(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([attempt()])}
        nodeId="implement"
        runtimeEnvironmentId="env-1"
      />
    )
    expect(screen.getByRole('button', { name: 'Open transcript' })).toBeDisabled()

    rerender(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([attempt({ taskId: 'task_abc' })])}
        nodeId="implement"
        runtimeEnvironmentId="env-1"
      />
    )
    const button = screen.getByRole('button', { name: 'Open transcript' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(focusTaskMock).toHaveBeenCalledWith('task_abc', 'env-1', expect.any(Function))
  })

  it('disables Open workspace diff without a resolvable worktree, and opens it when resolved', () => {
    const { rerender } = render(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([attempt({ workspaceWorktreeId: 'wt-1' })])}
        nodeId="implement"
        runtimeEnvironmentId={null}
      />
    )
    expect(screen.getByRole('button', { name: 'Open workspace diff' })).toBeDisabled()

    useWorktreeByIdMock.mockReturnValue({ id: 'wt-1', path: '/repo/wt-1' })
    rerender(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([attempt({ workspaceWorktreeId: 'wt-1' })])}
        nodeId="implement"
        runtimeEnvironmentId={null}
      />
    )
    const button = screen.getByRole('button', { name: 'Open workspace diff' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(openAllDiffsMock).toHaveBeenCalledWith('wt-1', '/repo/wt-1')
  })

  it('shows the active iteration next to the state badge', () => {
    render(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([attempt({ iteration: 2 })])}
        nodeId="implement"
        runtimeEnvironmentId={null}
      />
    )

    expect(screen.getByText('Iteration 2')).toBeInTheDocument()
  })

  it('does not show an iteration badge for a non-loop attempt (iteration 0)', () => {
    render(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([attempt({ iteration: 0 })])}
        nodeId="implement"
        runtimeEnvironmentId={null}
      />
    )

    expect(screen.queryByText(/Iteration/)).not.toBeInTheDocument()
  })

  it('lists per-iteration results once a node has run more than one iteration', () => {
    render(
      <AttemptPanel
        definition={workflow()}
        snapshot={snapshot([
          attempt({
            id: 'attempt-0',
            iteration: 0,
            state: 'failed',
            failureReason: 'not approved',
            resultJson: { approved: false }
          }),
          attempt({
            id: 'attempt-1',
            iteration: 1,
            state: 'completed',
            resultJson: { approved: true }
          })
        ])}
        nodeId="implement"
        runtimeEnvironmentId={null}
      />
    )

    expect(screen.getByText('Iterations')).toBeInTheDocument()
    // The header badge (latest, iteration 1) plus one row per iteration (0 and 1).
    expect(screen.getAllByText('Iteration 1')).toHaveLength(2)
    expect(screen.getByText('Iteration 0')).toBeInTheDocument()
    expect(screen.getByText('not approved')).toBeInTheDocument()
    expect(screen.getByText(/"approved": false/)).toBeInTheDocument()
    // Appears twice: the iteration-1 row, and the "Result" section below (same, latest attempt).
    expect(screen.getAllByText(/"approved": true/)).toHaveLength(2)
  })
})
