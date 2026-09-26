// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitWorkflowsChangedWindowEvent } from '@/lib/workflows-changed-window-event'
import type { NodeAttemptView } from '../../../../../shared/workflows/workflow-run-types'

const { workflowRunShowMock } = vi.hoisted(() => ({ workflowRunShowMock: vi.fn() }))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowRunShow: workflowRunShowMock
}))

import {
  latestNodeAttempt,
  nodeAttemptStatuses,
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

function snapshotFixture(attempts: NodeAttemptView[] = []) {
  return {
    id: 'run-1',
    workflowName: 'wf',
    workflowSource: 'project' as const,
    workflowSnapshot: {
      version: 1 as const,
      name: 'wf',
      workspacePolicy: 'run-workspace' as const,
      roles: {},
      nodes: [],
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
