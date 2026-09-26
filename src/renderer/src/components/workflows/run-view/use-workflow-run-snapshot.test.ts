// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitWorkflowsChangedWindowEvent } from '@/lib/workflows-changed-window-event'
import type { LoopNode, Node } from '../../../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../../../shared/workflows/workflow-run-types'

const { workflowRunShowMock } = vi.hoisted(() => ({ workflowRunShowMock: vi.fn() }))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowRunShow: workflowRunShowMock
}))

import {
  attemptsByIteration,
  latestNodeAttempt,
  loopActiveIteration,
  nodeAttemptIterations,
  nodeAttemptStatuses,
  nodeAttemptWorkspaces,
  useWorkflowRunSnapshot
} from './use-workflow-run-snapshot'

const settings = { activeRuntimeEnvironmentId: null }

function attempt(patch: Partial<NodeAttemptView> = {}): NodeAttemptView {
  return {
    id: `attempt-${Math.random()}`,
    runId: 'run-1',
    nodeId: 'implement',
    nodeType: 'agent',
    iteration: 0,
    attemptIndex: 0,
    state: 'running',
    artifactsJson: [],
    ...patch
  }
}

function loopNode(patch: Partial<LoopNode> = {}): LoopNode {
  return {
    id: 'loop',
    type: 'loop',
    title: 'Loop',
    body: { nodeIds: ['implement', 'review'] },
    entryNodeId: 'implement',
    exitNodeId: 'review',
    maxIterations: 3,
    exitCondition: { path: 'approved', op: 'truthy' },
    onCapReached: 'fail',
    ...patch
  }
}

function snapshotFixture(attempts: NodeAttemptView[] = [], id = 'run-1', nodes: Node[] = []) {
  return {
    id,
    workflowName: 'wf',
    workflowSource: 'project' as const,
    workflowSnapshot: {
      version: 1 as const,
      name: 'wf',
      workspacePolicy: 'run-workspace' as const,
      roles: {},
      nodes,
      edges: [],
      layout: {}
    },
    workflowVersion: 'rev-1',
    objective: 'Ship it',
    repoId: 'repo-1',
    state: 'running' as const,
    concurrencyLimit: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    attempts,
    questions: [],
    messages: [],
    events: []
  }
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

type RunIdProps = { runId: string | null }
const runARunIdProps: RunIdProps = { runId: 'run-a' }

beforeEach(() => {
  workflowRunShowMock.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('useWorkflowRunSnapshot', () => {
  it('fetches the run snapshot on mount', async () => {
    const snapshot = snapshotFixture()
    workflowRunShowMock.mockResolvedValue(snapshot)

    const { result } = renderHook(() => useWorkflowRunSnapshot({ settings, runId: 'run-1' }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(workflowRunShowMock).toHaveBeenCalledWith(settings, 'run-1')
    expect(result.current.snapshot).toEqual(snapshot)
    expect(result.current.error).toBeNull()
  })

  it('does nothing without a run id', () => {
    const { result } = renderHook(() => useWorkflowRunSnapshot({ settings, runId: null }))

    expect(workflowRunShowMock).not.toHaveBeenCalled()
    expect(result.current.snapshot).toBeNull()
  })

  it('surfaces a fetch failure as an error', async () => {
    workflowRunShowMock.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useWorkflowRunSnapshot({ settings, runId: 'run-1' }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('boom')
    expect(result.current.snapshot).toBeNull()
  })

  it('refetches when workflows:changed fires for this run', async () => {
    workflowRunShowMock.mockResolvedValue(snapshotFixture())
    const { result } = renderHook(() => useWorkflowRunSnapshot({ settings, runId: 'run-1' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    workflowRunShowMock.mockClear()

    act(() => emitWorkflowsChangedWindowEvent({ runId: 'run-1', reason: 'attempt' }))

    await waitFor(() => expect(workflowRunShowMock).toHaveBeenCalledTimes(1))
  })

  it('ignores workflows:changed for a different run', async () => {
    workflowRunShowMock.mockResolvedValue(snapshotFixture())
    const { result } = renderHook(() => useWorkflowRunSnapshot({ settings, runId: 'run-1' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    workflowRunShowMock.mockClear()

    act(() => emitWorkflowsChangedWindowEvent({ runId: 'run-2', reason: 'attempt' }))

    expect(workflowRunShowMock).not.toHaveBeenCalled()
  })

  it('refresh re-fetches on demand', async () => {
    workflowRunShowMock.mockResolvedValue(snapshotFixture())
    const { result } = renderHook(() => useWorkflowRunSnapshot({ settings, runId: 'run-1' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    workflowRunShowMock.mockClear()

    await act(() => result.current.refresh())

    expect(workflowRunShowMock).toHaveBeenCalledTimes(1)
  })

  it('drops a stale response for a run the user has since left (switched to no active run)', async () => {
    const deferredA = createDeferred<ReturnType<typeof snapshotFixture>>()
    workflowRunShowMock.mockImplementation((_settings: unknown, runId: string) =>
      runId === 'run-a' ? deferredA.promise : Promise.reject(new Error('unexpected runId'))
    )

    const { result, rerender } = renderHook(
      ({ runId }: RunIdProps) => useWorkflowRunSnapshot({ settings, runId }),
      { initialProps: runARunIdProps }
    )
    await waitFor(() => expect(workflowRunShowMock).toHaveBeenCalledWith(settings, 'run-a'))

    // The user switches away before run-a's slow response ever arrives.
    rerender({ runId: null })
    expect(result.current.snapshot).toBeNull()

    await act(async () => {
      deferredA.resolve(snapshotFixture([], 'run-a'))
      await flushMicrotasks()
    })

    expect(result.current.snapshot).toBeNull()
  })

  it('drops a stale response for a run the user has since left (switched to a different run)', async () => {
    const deferredA = createDeferred<ReturnType<typeof snapshotFixture>>()
    const snapshotB = snapshotFixture([], 'run-b')
    workflowRunShowMock.mockImplementation((_settings: unknown, runId: string) =>
      runId === 'run-a' ? deferredA.promise : Promise.resolve(snapshotB)
    )

    const { result, rerender } = renderHook(
      ({ runId }: RunIdProps) => useWorkflowRunSnapshot({ settings, runId }),
      { initialProps: runARunIdProps }
    )
    await waitFor(() => expect(workflowRunShowMock).toHaveBeenCalledWith(settings, 'run-a'))

    // The user starts a second run before run-a's slow response ever arrives.
    rerender({ runId: 'run-b' })
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshotB))

    await act(async () => {
      deferredA.resolve(snapshotFixture([], 'run-a'))
      await flushMicrotasks()
    })

    expect(result.current.snapshot).toEqual(snapshotB)
  })
})

describe('latestNodeAttempt', () => {
  it('picks the highest iteration, then attempt index', () => {
    const attempts = [
      attempt({ id: 'a', nodeId: 'n', iteration: 0, attemptIndex: 0 }),
      attempt({ id: 'b', nodeId: 'n', iteration: 1, attemptIndex: 0 }),
      attempt({ id: 'c', nodeId: 'n', iteration: 1, attemptIndex: 1 }),
      attempt({ id: 'd', nodeId: 'other', iteration: 5, attemptIndex: 5 })
    ]

    expect(latestNodeAttempt(attempts, 'n')?.id).toBe('c')
  })

  it('returns undefined when the node has no attempts', () => {
    expect(latestNodeAttempt([attempt({ nodeId: 'n' })], 'missing')).toBeUndefined()
  })
})

describe('nodeAttemptStatuses', () => {
  it('maps each node to its latest attempt state', () => {
    const snapshot = snapshotFixture([
      attempt({ nodeId: 'implement', state: 'completed', iteration: 0, attemptIndex: 0 }),
      attempt({ nodeId: 'review', state: 'running', iteration: 0, attemptIndex: 0 })
    ])

    expect(nodeAttemptStatuses(snapshot)).toEqual({ implement: 'completed', review: 'running' })
  })

  it('returns an empty map for a null snapshot', () => {
    expect(nodeAttemptStatuses(null)).toEqual({})
  })
})

describe('nodeAttemptWorkspaces', () => {
  it("maps each node to its latest attempt's workspaceWorktreeId", () => {
    const snapshot = snapshotFixture([
      attempt({ nodeId: 'implement', iteration: 0, attemptIndex: 0, workspaceWorktreeId: 'wt-1' }),
      attempt({ nodeId: 'review', iteration: 0, attemptIndex: 0 })
    ])

    expect(nodeAttemptWorkspaces(snapshot)).toEqual({ implement: 'wt-1' })
  })

  it('omits a node whose latest attempt has no recorded workspace', () => {
    const snapshot = snapshotFixture([attempt({ nodeId: 'implement', iteration: 0 })])

    expect(nodeAttemptWorkspaces(snapshot)).toEqual({})
  })

  it('returns an empty map for a null snapshot', () => {
    expect(nodeAttemptWorkspaces(null)).toEqual({})
  })
})

describe('attemptsByIteration', () => {
  it('returns one attempt per iteration, ascending, using the latest attemptIndex within each', () => {
    const attempts = [
      attempt({ id: 'a', nodeId: 'review', iteration: 0, attemptIndex: 0, state: 'failed' }),
      attempt({ id: 'b', nodeId: 'review', iteration: 1, attemptIndex: 0, state: 'failed' }),
      attempt({ id: 'c', nodeId: 'review', iteration: 1, attemptIndex: 1, state: 'completed' }),
      attempt({ id: 'd', nodeId: 'other', iteration: 9, attemptIndex: 0 })
    ]

    expect(attemptsByIteration(attempts, 'review').map((a) => a.id)).toEqual(['a', 'c'])
  })

  it('returns an empty list for a node with no attempts', () => {
    expect(attemptsByIteration([attempt({ nodeId: 'review' })], 'missing')).toEqual([])
  })
})

describe('loopActiveIteration', () => {
  const loop = loopNode()

  it("reads the highest iteration among the body nodes' attempts while running (index 2 -> 3, review round 2)", () => {
    // Shaped like the engine's actual attempts: one Loop attempt stuck at iteration 0, plus
    // real per-iteration body-node attempts (0, 1, 2 -> three iterations so far).
    const attempts = [
      attempt({
        nodeId: 'loop',
        nodeType: 'loop',
        iteration: 0,
        attemptIndex: 0,
        state: 'running'
      }),
      attempt({ nodeId: 'implement', iteration: 0, attemptIndex: 0, state: 'completed' }),
      attempt({ nodeId: 'review', iteration: 0, attemptIndex: 0, state: 'failed' }),
      attempt({ nodeId: 'implement', iteration: 1, attemptIndex: 0, state: 'completed' }),
      attempt({ nodeId: 'review', iteration: 1, attemptIndex: 0, state: 'failed' }),
      attempt({ nodeId: 'implement', iteration: 2, attemptIndex: 0, state: 'completed' }),
      attempt({ nodeId: 'review', iteration: 2, attemptIndex: 0, state: 'running' })
    ]

    expect(loopActiveIteration(loop, attempts)).toBe(3)
  })

  it("prefers the settled Loop attempt's resultJson.iterations once terminal", () => {
    const attempts = [
      attempt({
        nodeId: 'loop',
        nodeType: 'loop',
        iteration: 0,
        attemptIndex: 0,
        state: 'completed',
        resultJson: { iterations: 3, exitResult: { approved: true } }
      }),
      attempt({ nodeId: 'implement', iteration: 0, attemptIndex: 0, state: 'completed' }),
      attempt({ nodeId: 'review', iteration: 0, attemptIndex: 0, state: 'completed' })
    ]

    expect(loopActiveIteration(loop, attempts)).toBe(3)
  })

  it('falls back to the body-node count when the settled result has no iterations field', () => {
    const attempts = [
      attempt({ nodeId: 'loop', nodeType: 'loop', iteration: 0, attemptIndex: 0, state: 'failed' }),
      attempt({ nodeId: 'implement', iteration: 0, attemptIndex: 0, state: 'completed' }),
      attempt({ nodeId: 'review', iteration: 0, attemptIndex: 0, state: 'failed' })
    ]

    expect(loopActiveIteration(loop, attempts)).toBe(1)
  })

  it('returns undefined before the Loop has any activity', () => {
    expect(loopActiveIteration(loop, [])).toBeUndefined()
  })
})

describe('nodeAttemptIterations', () => {
  it("maps each Loop node to its active iteration from the definition's body nodes (review round 2)", () => {
    const snapshot = snapshotFixture(
      [
        attempt({
          nodeId: 'loop',
          nodeType: 'loop',
          iteration: 0,
          attemptIndex: 0,
          state: 'running'
        }),
        attempt({ nodeId: 'implement', iteration: 0, attemptIndex: 0, state: 'completed' }),
        attempt({ nodeId: 'review', iteration: 0, attemptIndex: 0, state: 'failed' }),
        attempt({ nodeId: 'implement', iteration: 1, attemptIndex: 0, state: 'completed' }),
        attempt({ nodeId: 'review', iteration: 1, attemptIndex: 0, state: 'failed' }),
        attempt({ nodeId: 'implement', iteration: 2, attemptIndex: 0, state: 'completed' }),
        attempt({ nodeId: 'review', iteration: 2, attemptIndex: 0, state: 'running' })
      ],
      'run-1',
      [loopNode()]
    )

    expect(nodeAttemptIterations(snapshot)).toEqual({ loop: 3 })
  })

  it('omits a Loop node with no activity yet', () => {
    const snapshot = snapshotFixture([], 'run-1', [loopNode()])

    expect(nodeAttemptIterations(snapshot)).toEqual({})
  })

  it('returns an empty map for a null snapshot', () => {
    expect(nodeAttemptIterations(null)).toEqual({})
  })
})
