// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../shared/workflows/workflow-definition-types'

const {
  workflowReadMock,
  workflowWriteMock,
  workflowValidateMock,
  workflowListMock,
  workflowDeleteMock,
  workflowDuplicateMock,
  workflowRunStartMock,
  workflowRunCancelMock,
  workflowRunShowMock,
  toastErrorMock,
  toastMessageMock
} = vi.hoisted(() => ({
  workflowReadMock: vi.fn(),
  workflowWriteMock: vi.fn(),
  workflowValidateMock: vi.fn(),
  workflowListMock: vi.fn(),
  workflowDeleteMock: vi.fn(),
  workflowDuplicateMock: vi.fn(),
  workflowRunStartMock: vi.fn(),
  workflowRunCancelMock: vi.fn(),
  workflowRunShowMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastMessageMock: vi.fn()
}))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowRead: workflowReadMock,
  workflowWrite: workflowWriteMock,
  workflowValidate: workflowValidateMock,
  workflowList: workflowListMock,
  workflowDelete: workflowDeleteMock,
  workflowDuplicate: workflowDuplicateMock,
  workflowRunStart: workflowRunStartMock,
  workflowRunCancel: workflowRunCancelMock,
  workflowRunShow: workflowRunShowMock
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, message: toastMessageMock } }))

const { useAppStoreMock, useActiveRepoMock, useActiveWorktreeMock } = vi.hoisted(() => ({
  useAppStoreMock: vi.fn(),
  useActiveRepoMock: vi.fn(),
  useActiveWorktreeMock: vi.fn()
}))

vi.mock('@/store', () => ({ useAppStore: useAppStoreMock }))
vi.mock('@/store/selectors', () => ({
  useActiveRepo: useActiveRepoMock,
  useActiveWorktree: useActiveWorktreeMock
}))

import { useWorkflowsPageController } from './use-workflows-page-controller'

const settings = { activeRuntimeEnvironmentId: null }

function savedWorkflow(patch: Partial<Workflow> = {}): Workflow {
  return {
    version: 1,
    name: 'wf-a',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
    layout: { start: { x: 0, y: 0 }, end: { x: 320, y: 0 } },
    ...patch
  }
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** Lets a resolved/rejected promise's `.then`/`.catch` chain (and the state update inside it)
 *  actually run before the next assertion. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  workflowReadMock.mockReset()
  workflowWriteMock.mockReset()
  workflowValidateMock.mockReset()
  workflowListMock.mockReset().mockResolvedValue({ workflows: [] })
  workflowDeleteMock.mockReset()
  workflowDuplicateMock.mockReset()
  workflowRunStartMock.mockReset()
  workflowRunCancelMock.mockReset()
  workflowRunShowMock.mockReset()
  toastErrorMock.mockReset()
  toastMessageMock.mockReset()
  useAppStoreMock
    .mockReset()
    .mockImplementation((selector: (state: { settings: typeof settings }) => unknown) =>
      selector({ settings })
    )
  useActiveRepoMock.mockReset().mockReturnValue({ id: 'repo-1' })
  useActiveWorktreeMock.mockReset().mockReturnValue(null)
})

describe('useWorkflowsPageController', () => {
  it('opens a workflow and runs the debounced host validation for it', async () => {
    vi.useFakeTimers()
    try {
      const definition = savedWorkflow()
      workflowReadMock.mockResolvedValue({
        definition,
        raw: 'raw',
        revision: 'rev-1',
        problems: []
      })
      workflowValidateMock.mockResolvedValue({ problems: [] })
      const { result } = renderHook(() => useWorkflowsPageController())

      await act(() =>
        result.current.openWorkflow({ name: 'wf-a', source: 'project', path: '', valid: true })
      )
      expect(result.current.session.status).toBe('ready')

      await act(() => vi.advanceTimersByTimeAsync(400))

      expect(workflowValidateMock).toHaveBeenCalledWith(settings, { repo: 'repo-1', definition })
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves the open workflow through workflow.write with the read revision', async () => {
    const definition = savedWorkflow()
    workflowReadMock.mockResolvedValue({ definition, raw: 'raw', revision: 'rev-1', problems: [] })
    workflowWriteMock.mockResolvedValue({ revision: 'rev-2' })
    workflowValidateMock.mockResolvedValue({ problems: [] })
    const { result } = renderHook(() => useWorkflowsPageController())
    await act(() =>
      result.current.openWorkflow({ name: 'wf-a', source: 'project', path: '', valid: true })
    )
    act(() => {
      result.current.session.editor.dispatch({
        type: 'update-node',
        node: { id: 'start', type: 'start', title: 'Renamed' }
      })
    })
    expect(result.current.session.editor.state.dirty).toBe(true)

    await act(() => result.current.session.save())

    expect(workflowWriteMock).toHaveBeenCalledWith(
      settings,
      expect.objectContaining({ repo: 'repo-1', name: 'wf-a', expectedRevision: 'rev-1' })
    )
    expect(result.current.session.editor.state.dirty).toBe(false)
  })

  it('never lets a slow, stale workflow.validate response overwrite a newer one (race guard)', async () => {
    vi.useFakeTimers()
    try {
      const definitionA = savedWorkflow({ name: 'wf-a' })
      const definitionB = savedWorkflow({ name: 'wf-b' })
      workflowReadMock.mockImplementation(async (_settings: unknown, params: { name: string }) => ({
        definition: params.name === 'wf-a' ? definitionA : definitionB,
        raw: 'raw',
        revision: `rev-${params.name}`,
        problems: []
      }))
      const deferredA = createDeferred<{ problems: WorkflowProblem[] }>()
      const deferredB = createDeferred<{ problems: WorkflowProblem[] }>()
      workflowValidateMock.mockImplementation(
        (_settings: unknown, params: { definition: Workflow }) =>
          params.definition.name === 'wf-a' ? deferredA.promise : deferredB.promise
      )
      const { result } = renderHook(() => useWorkflowsPageController())

      await act(() =>
        result.current.openWorkflow({ name: 'wf-a', source: 'project', path: '', valid: true })
      )
      await act(() => vi.advanceTimersByTimeAsync(400))
      expect(workflowValidateMock).toHaveBeenCalledTimes(1)

      // Switch to a different workflow before A's validate call ever resolves.
      await act(() =>
        result.current.openWorkflow({ name: 'wf-b', source: 'project', path: '', valid: true })
      )
      await act(() => vi.advanceTimersByTimeAsync(400))
      expect(workflowValidateMock).toHaveBeenCalledTimes(2)

      // B's (current) result lands first...
      await act(async () => {
        deferredB.resolve({
          problems: [{ code: 'fresh_b', message: 'from B', severity: 'warning' }]
        })
        await flushMicrotasks()
      })
      expect(result.current.problems.some((problem) => problem.code === 'fresh_b')).toBe(true)

      // ...then A's stale, slower result arrives after — it must not clobber B's.
      await act(async () => {
        deferredA.resolve({
          problems: [{ code: 'stale_a', message: 'from A', severity: 'warning' }]
        })
        await flushMicrotasks()
      })

      expect(result.current.problems.some((problem) => problem.code === 'stale_a')).toBe(false)
      expect(result.current.problems.some((problem) => problem.code === 'fresh_b')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  describe('run', () => {
    async function openReadyWorkflow(result: {
      current: ReturnType<typeof useWorkflowsPageController>
    }): Promise<void> {
      const definition = savedWorkflow()
      workflowReadMock.mockResolvedValue({
        definition,
        raw: 'raw',
        revision: 'rev-1',
        problems: []
      })
      workflowValidateMock.mockResolvedValue({ problems: [] })
      await act(() =>
        result.current.openWorkflow({ name: 'wf-a', source: 'project', path: '', valid: true })
      )
    }

    it('starts a run through workflow.run.start for the open workflow', async () => {
      workflowRunStartMock.mockResolvedValue({ runId: 'run-1' })
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)

      await act(() => result.current.run.start('Add CSV export'))

      expect(workflowRunStartMock).toHaveBeenCalledWith(settings, {
        repo: 'repo-1',
        name: 'wf-a',
        source: 'project',
        objective: 'Add CSV export'
      })
      expect(result.current.run.runId).toBe('run-1')
    })

    it('reports a workflow.run.start failure as a toast without leaving `starting` stuck', async () => {
      workflowRunStartMock.mockRejectedValue(new Error('host unreachable'))
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)

      await act(() => result.current.run.start('Add CSV export'))

      expect(toastErrorMock).toHaveBeenCalledWith('host unreachable')
      expect(result.current.run.runId).toBeNull()
      expect(result.current.run.starting).toBe(false)
    })

    it('stops the active run through workflow.run.cancel', async () => {
      workflowRunStartMock.mockResolvedValue({ runId: 'run-1' })
      workflowRunCancelMock.mockResolvedValue({ state: 'cancelled' })
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)
      await act(() => result.current.run.start('Add CSV export'))

      await act(() => result.current.run.stop())

      expect(workflowRunCancelMock).toHaveBeenCalledWith(settings, 'run-1')
    })

    it('shows a gentle message instead of an error when cancel is not yet implemented', async () => {
      workflowRunStartMock.mockResolvedValue({ runId: 'run-1' })
      workflowRunCancelMock.mockRejectedValue(new Error('workflow_not_implemented'))
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)
      await act(() => result.current.run.start('Add CSV export'))

      await act(() => result.current.run.stop())

      expect(toastMessageMock).toHaveBeenCalled()
      expect(toastErrorMock).not.toHaveBeenCalled()
    })

    it('clears the active run when the user switches to a different workflow', async () => {
      workflowRunStartMock.mockResolvedValue({ runId: 'run-1' })
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)
      await act(() => result.current.run.start('Add CSV export'))
      expect(result.current.run.runId).toBe('run-1')

      const otherDefinition = savedWorkflow({ name: 'wf-b' })
      workflowReadMock.mockResolvedValue({
        definition: otherDefinition,
        raw: 'raw',
        revision: 'rev-2',
        problems: []
      })
      await act(() =>
        result.current.openWorkflow({ name: 'wf-b', source: 'project', path: '', valid: true })
      )

      expect(result.current.run.runId).toBeNull()
    })
  })
})
