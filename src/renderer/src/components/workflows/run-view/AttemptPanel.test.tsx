// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentNode,
  JoinNode,
  LoopNode,
  RouterNode,
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

function reviewNode(): AgentNode {
  return {
    id: 'review',
    type: 'agent',
    title: 'Review',
    prompt: 'Review it.',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1, escalationGraceMs: 1 }
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
    nodes: [startNode(), loopNode(), agentNode(), reviewNode()]
  }
}

function joinNode(): JoinNode {
  return { id: 'join', type: 'join', title: 'Join', policy: 'all', onFailure: 'fail' }
}

function workflowWithJoin(): Workflow {
  return { ...workflow(), nodes: [startNode(), agentNode(), joinNode()] }
}

function routerNode(): RouterNode {
  return {
    id: 'router',
    type: 'router',
    title: 'Router',
    prompt: 'Decide.',
    choices: ['bugfix', 'feature']
  }
}

function workflowWithRouter(): Workflow {
  return { ...workflow(), nodes: [startNode(), routerNode()] }
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

function snapshot(
  attempts: NodeAttemptView[],
  workflowSnapshot: Workflow = workflow()
): WorkflowRunSnapshotView {
  return {
    id: 'run-1',
    workflowName: 'wf',
    workflowSource: 'project',
    workflowSnapshot,
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

  describe('a selected Loop node (review round 2)', () => {
    // Shaped like the engine's actual attempts: the Loop's own attempt is stuck at iteration 0,
    // while its body nodes (implement/review) carry real per-iteration attempts (0, 1, 2).
    function bodyAttempts(): NodeAttemptView[] {
      return [
        attempt({
          id: 'loop-attempt',
          nodeId: 'loop',
          nodeType: 'loop',
          iteration: 0,
          attemptIndex: 0,
          state: 'running'
        }),
        attempt({ id: 'implement-0', nodeId: 'implement', iteration: 0, state: 'completed' }),
        attempt({
          id: 'review-0',
          nodeId: 'review',
          iteration: 0,
          state: 'failed',
          failureReason: 'not approved',
          resultJson: { approved: false }
        }),
        attempt({ id: 'implement-1', nodeId: 'implement', iteration: 1, state: 'completed' }),
        attempt({
          id: 'review-1',
          nodeId: 'review',
          iteration: 1,
          state: 'failed',
          resultJson: { approved: false }
        }),
        attempt({ id: 'implement-2', nodeId: 'implement', iteration: 2, state: 'completed' }),
        attempt({
          id: 'review-2',
          nodeId: 'review',
          iteration: 2,
          state: 'completed',
          resultJson: { approved: true }
        })
      ]
    }

    it("shows the Loop's active iteration from its body nodes, not its own stuck-at-0 attempt", () => {
      render(
        <AttemptPanel
          definition={workflowWithLoop()}
          snapshot={snapshot(bodyAttempts(), workflowWithLoop())}
          nodeId="loop"
          runtimeEnvironmentId={null}
        />
      )

      // Highest body iteration index is 2 (a third pass) -> displayed as "3".
      expect(screen.getByText('Iteration 3')).toBeInTheDocument()
    })

    it("lists per-iteration results from the exit node's attempts", () => {
      render(
        <AttemptPanel
          definition={workflowWithLoop()}
          snapshot={snapshot(bodyAttempts(), workflowWithLoop())}
          nodeId="loop"
          runtimeEnvironmentId={null}
        />
      )

      expect(screen.getByText('Iterations')).toBeInTheDocument()
      // One row per iteration (0, 1, 2); the header badge shows "Iteration 3" separately.
      expect(screen.getByText('Iteration 0')).toBeInTheDocument()
      expect(screen.getByText('Iteration 1')).toBeInTheDocument()
      expect(screen.getByText('Iteration 2')).toBeInTheDocument()
      expect(screen.getByText('Iteration 3')).toBeInTheDocument()
      expect(screen.getByText('not approved')).toBeInTheDocument()
    })
  })

  describe('a selected Join node (US3 AS3/AS4)', () => {
    it('shows per-branch outcomes instead of the raw result JSON', () => {
      render(
        <AttemptPanel
          definition={workflowWithJoin()}
          snapshot={snapshot(
            [
              attempt({
                id: 'join-attempt',
                nodeId: 'join',
                nodeType: 'join',
                resultJson: { branches: { implement: 'completed', other: 'failed' } }
              })
            ],
            workflowWithJoin()
          )}
          nodeId="join"
          runtimeEnvironmentId={null}
        />
      )

      expect(screen.getByText('Branches')).toBeInTheDocument()
      expect(screen.getByText('implement')).toBeInTheDocument()
      // "Completed" appears twice: the attempt's own state badge, and the "implement" branch row.
      expect(screen.getAllByText('Completed')).toHaveLength(2)
      expect(screen.getByText('other')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.queryByText(/"branches"/)).not.toBeInTheDocument()
    })

    it('falls back to the raw result JSON when resultJson is not the expected shape', () => {
      render(
        <AttemptPanel
          definition={workflowWithJoin()}
          snapshot={snapshot(
            [
              attempt({
                id: 'join-attempt',
                nodeId: 'join',
                nodeType: 'join',
                resultJson: { unexpected: true }
              })
            ],
            workflowWithJoin()
          )}
          nodeId="join"
          runtimeEnvironmentId={null}
        />
      )

      expect(screen.queryByText('Branches')).not.toBeInTheDocument()
      expect(screen.getByText(/"unexpected": true/)).toBeInTheDocument()
    })
  })

  describe('a selected Router node (US3 AS6, FR-029)', () => {
    it('shows the recorded choice and reason instead of the raw result JSON', () => {
      render(
        <AttemptPanel
          definition={workflowWithRouter()}
          snapshot={snapshot(
            [
              attempt({
                id: 'router-attempt',
                nodeId: 'router',
                nodeType: 'router',
                resultJson: { choice: 'feature', reason: 'Adds new capability.' }
              })
            ],
            workflowWithRouter()
          )}
          nodeId="router"
          runtimeEnvironmentId={null}
        />
      )

      expect(screen.getByText('Choice')).toBeInTheDocument()
      expect(screen.getByText('feature')).toBeInTheDocument()
      expect(screen.getByText('Reason')).toBeInTheDocument()
      expect(screen.getByText('Adds new capability.')).toBeInTheDocument()
      expect(screen.queryByText(/"choice"/)).not.toBeInTheDocument()
    })

    it('falls back to the raw result JSON when resultJson is not the expected shape', () => {
      render(
        <AttemptPanel
          definition={workflowWithRouter()}
          snapshot={snapshot(
            [
              attempt({
                id: 'router-attempt',
                nodeId: 'router',
                nodeType: 'router',
                resultJson: { unexpected: true }
              })
            ],
            workflowWithRouter()
          )}
          nodeId="router"
          runtimeEnvironmentId={null}
        />
      )

      expect(screen.queryByText('Choice')).not.toBeInTheDocument()
      expect(screen.getByText(/"unexpected": true/)).toBeInTheDocument()
    })
  })
})
