// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
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
  workflowDraftMock,
  workflowRunStartMock,
  workflowRunCancelMock,
  workflowRunPauseMock,
  workflowRunResumeMock,
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
  workflowDraftMock: vi.fn(),
  workflowRunStartMock: vi.fn(),
  workflowRunCancelMock: vi.fn(),
  workflowRunPauseMock: vi.fn(),
  workflowRunResumeMock: vi.fn(),
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
  workflowDraft: workflowDraftMock,
  workflowRunStart: workflowRunStartMock,
  workflowRunCancel: workflowRunCancelMock,
  workflowRunPause: workflowRunPauseMock,
  workflowRunResume: workflowRunResumeMock,
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
const storeState = { settings, workflowsResume: null, setWorkflowsResume: vi.fn() }

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
  workflowDraftMock.mockReset()
  workflowRunStartMock.mockReset()
  workflowRunCancelMock.mockReset()
  workflowRunPauseMock.mockReset()
  workflowRunResumeMock.mockReset()
  workflowRunShowMock.mockReset()
  toastErrorMock.mockReset()
  toastMessageMock.mockReset()
  useAppStoreMock
    .mockReset()
    .mockImplementation((selector: (state: typeof storeState) => unknown) => selector(storeState))
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

    it('backToEditing drops the shown run but keeps the workflow open (F9)', async () => {
      workflowRunStartMock.mockResolvedValue({ runId: 'run-1' })
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)
      await act(() => result.current.run.start('Add CSV export'))
      expect(result.current.run.runId).toBe('run-1')

      act(() => result.current.backToEditing())

      expect(result.current.run.runId).toBeNull()
      expect(result.current.session.status).toBe('ready')
    })

    it('disables Run (with the no-project reason) when the active project drops out from under a still-ready session (F6)', async () => {
      const { result, rerender } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)
      expect(result.current.canRun).toBe(true)
      expect(result.current.runDisabledReason).toBeUndefined()

      // The user switches away from the active project while the workflow editor is still open.
      useActiveRepoMock.mockReturnValue(undefined)
      rerender()

      expect(result.current.session.status).toBe('ready')
      expect(result.current.canRun).toBe(false)
      expect(result.current.runDisabledReason).toBe('Add or select a project to create workflows.')

      // Run must actually no-op now, not just look disabled.
      await act(() => result.current.run.start('Add CSV export'))
      expect(workflowRunStartMock).not.toHaveBeenCalled()
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

    it('pauses the active run through workflow.run.pause', async () => {
      workflowRunStartMock.mockResolvedValue({ runId: 'run-1' })
      workflowRunPauseMock.mockResolvedValue({ state: 'paused' })
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)
      await act(() => result.current.run.start('Add CSV export'))

      await act(() => result.current.run.pause())

      expect(workflowRunPauseMock).toHaveBeenCalledWith(settings, 'run-1')
    })

    it('shows a gentle message instead of an error when a host lacks workflow.run.pause', async () => {
      workflowRunStartMock.mockResolvedValue({ runId: 'run-1' })
      workflowRunPauseMock.mockRejectedValue(new Error('method_not_found'))
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)
      await act(() => result.current.run.start('Add CSV export'))

      await act(() => result.current.run.pause())

      expect(toastMessageMock).toHaveBeenCalled()
      expect(toastErrorMock).not.toHaveBeenCalled()
    })

    it('resumes the active run through workflow.run.resume', async () => {
      workflowRunStartMock.mockResolvedValue({ runId: 'run-1' })
      workflowRunResumeMock.mockResolvedValue({ state: 'running' })
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)
      await act(() => result.current.run.start('Add CSV export'))

      await act(() => result.current.run.resume())

      expect(workflowRunResumeMock).toHaveBeenCalledWith(settings, 'run-1')
    })

    it('opens a past run from history, replacing what the run view displays', async () => {
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)
      workflowRunShowMock.mockResolvedValue({
        id: 'run-9',
        workflowName: 'wf-a',
        workflowSource: 'project',
        workflowSnapshot: savedWorkflow(),
        workflowVersion: 'rev-1',
        objective: 'past objective',
        repoId: 'repo-1',
        state: 'failed',
        concurrencyLimit: 4,
        createdAt: '2026-01-01T00:00:00.000Z',
        attempts: [],
        questions: [],
        messages: [],
        events: []
      })

      act(() => result.current.run.openRun('run-9'))

      expect(result.current.run.runId).toBe('run-9')
      await waitFor(() => expect(workflowRunShowMock).toHaveBeenCalledWith(settings, 'run-9'))
      await waitFor(() => expect(result.current.run.snapshot?.id).toBe('run-9'))
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

  describe('drafting (US6)', () => {
    it('draftWorkflow calls workflow.draft for the active repo and objective', async () => {
      const drafted = savedWorkflow({ name: 'triage-tickets' })
      const draftedResult = { definition: drafted, problems: [], draft: true, runId: 'run-1' }
      workflowDraftMock.mockResolvedValue(draftedResult)
      const { result } = renderHook(() => useWorkflowsPageController())

      const draftResult = await result.current.draftWorkflow('Triage new support tickets')

      expect(workflowDraftMock).toHaveBeenCalledWith(settings, {
        repo: 'repo-1',
        objective: 'Triage new support tickets'
      })
      expect(draftResult).toEqual(draftedResult)
    })

    it('openDraft loads the definition into the editor as an unsaved draft and clears run/selection state', async () => {
      workflowRunStartMock.mockResolvedValue({ runId: 'run-1' })
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
      await act(() => result.current.run.start('Add CSV export'))
      expect(result.current.run.runId).toBe('run-1')

      const drafted = savedWorkflow({ name: 'triage-tickets' })
      act(() => result.current.openDraft(drafted))

      expect(result.current.session.isDraft).toBe(true)
      expect(result.current.session.openRef).toBeNull()
      expect(result.current.session.editor.state.definition).toEqual(drafted)
      expect(result.current.run.runId).toBeNull()
    })

    it('saveDraft writes the draft then refreshes the list, so it appears without a remount', async () => {
      const drafted = savedWorkflow({ name: 'triage-tickets' })
      workflowWriteMock.mockResolvedValue({ revision: 'rev-1' })
      const { result } = renderHook(() => useWorkflowsPageController())
      act(() => result.current.openDraft(drafted))
      workflowListMock.mockClear()

      await act(() => result.current.saveDraft('triage-tickets', 'project'))

      expect(workflowWriteMock).toHaveBeenCalledWith(settings, {
        repo: 'repo-1',
        name: 'triage-tickets',
        source: 'project',
        definition: expect.objectContaining({ name: 'triage-tickets' })
      })
      expect(workflowListMock).toHaveBeenCalledWith(settings, 'repo-1')
      expect(result.current.session.isDraft).toBe(false)
      expect(result.current.session.openRef).toEqual({ name: 'triage-tickets', source: 'project' })
    })

    it('saveDraft does not refresh the list when the write fails', async () => {
      const drafted = savedWorkflow({ name: 'triage-tickets' })
      workflowWriteMock.mockRejectedValueOnce(new Error('workflow_name_taken'))
      const { result } = renderHook(() => useWorkflowsPageController())
      act(() => result.current.openDraft(drafted))
      workflowListMock.mockClear()

      await expect(
        act(() => result.current.saveDraft('triage-tickets', 'project'))
      ).rejects.toThrow('workflow_name_taken')

      expect(workflowListMock).not.toHaveBeenCalled()
      expect(result.current.session.isDraft).toBe(true)
    })
  })

  describe('adding nodes from the editor (U63)', () => {
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

    it('adds a node of the requested kind, marks it dirty, and selects the new node', async () => {
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)
      const nodeCountBefore = result.current.session.editor.state.definition.nodes.length

      act(() => result.current.addNode('agent'))

      const nodes = result.current.session.editor.state.definition.nodes
      expect(nodes).toHaveLength(nodeCountBefore + 1)
      const added = nodes.at(-1)
      expect(added?.type).toBe('agent')
      expect(result.current.selectedNodeId).toBe(added?.id)
      expect(result.current.selectedEdgeId).toBeUndefined()
      expect(result.current.session.editor.state.dirty).toBe(true)
    })

    it('places the new node in the layout at a position not already occupied', async () => {
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)

      act(() => result.current.addNode('agent'))

      const { definition } = result.current.session.editor.state
      const added = definition.nodes.at(-1)
      expect(added).toBeDefined()
      const position = added ? definition.layout[added.id] : undefined
      expect(position).toBeDefined()
      const occupiedPositions = definition.nodes
        .filter((node) => node.id !== added?.id)
        .map((node) => definition.layout[node.id])
      expect(occupiedPositions).not.toContainEqual(position)
    })

    it('lets two added Agent nodes be wired start -> agent -> agent -> end and saved clean', async () => {
      workflowWriteMock.mockResolvedValue({ revision: 'rev-2' })
      const { result } = renderHook(() => useWorkflowsPageController())
      await openReadyWorkflow(result)

      act(() => result.current.addNode('agent'))
      act(() => result.current.addNode('agent'))
      const [agent1, agent2] = result.current.session.editor.state.definition.nodes.filter(
        (node) => node.type === 'agent'
      )
      if (agent1?.type !== 'agent' || agent2?.type !== 'agent') {
        throw new Error('expected two Agent nodes to have been added')
      }

      act(() => {
        // A freshly added node has no agent assigned (deliberately deferred to a separate unit —
        // U63-review Important #2); assign one here so this test stays about what U63 owns (the
        // node wires up and saves cleanly), not about that unrelated, still-unassigned-agent gap.
        result.current.session.editor.dispatch({
          type: 'update-node',
          node: { ...agent1, overrides: { agent: 'claude' } }
        })
        result.current.session.editor.dispatch({
          type: 'update-node',
          node: { ...agent2, overrides: { agent: 'claude' } }
        })
        result.current.session.editor.dispatch({ type: 'connect', from: 'start', to: agent1.id })
        result.current.session.editor.dispatch({ type: 'connect', from: agent1.id, to: agent2.id })
        result.current.session.editor.dispatch({ type: 'connect', from: agent2.id, to: 'end' })
      })

      expect(result.current.problems.some((problem) => problem.severity === 'error')).toBe(false)

      await act(() => result.current.session.save())

      expect(workflowWriteMock).toHaveBeenCalledWith(
        settings,
        expect.objectContaining({
          repo: 'repo-1',
          name: 'wf-a',
          definition: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({ id: agent1.id, type: 'agent' }),
              expect.objectContaining({ id: agent2.id, type: 'agent' })
            ])
          })
        })
      )
      expect(result.current.session.editor.state.dirty).toBe(false)
    })
  })

  describe('no active project (F6)', () => {
    it('reports noActiveProjectReason and canRun=false from the initial mount, with no active repo', () => {
      useActiveRepoMock.mockReturnValue(undefined)

      const { result } = renderHook(() => useWorkflowsPageController())

      expect(result.current.repoId).toBeUndefined()
      expect(result.current.noActiveProjectReason).toBe(
        'Add or select a project to create workflows.'
      )
      expect(result.current.runDisabledReason).toBe('Add or select a project to create workflows.')
      expect(result.current.canRun).toBe(false)
    })

    it('duplicateWorkflow rejects with the no-project reason instead of doing nothing (fix round 1)', async () => {
      useActiveRepoMock.mockReturnValue(undefined)
      const { result } = renderHook(() => useWorkflowsPageController())
      const target = { name: 'ship-it', source: 'project' as const, path: '', valid: true }

      await expect(
        act(() => result.current.duplicateWorkflow(target, 'ship-it-copy'))
      ).rejects.toThrow('Add or select a project to create workflows.')

      expect(workflowDuplicateMock).not.toHaveBeenCalled()
    })

    it('deleteWorkflow toasts the no-project reason instead of doing nothing (fix round 1)', async () => {
      useActiveRepoMock.mockReturnValue(undefined)
      const { result } = renderHook(() => useWorkflowsPageController())
      const target = { name: 'ship-it', source: 'project' as const, path: '', valid: true }

      await act(() => result.current.deleteWorkflow(target))

      expect(toastErrorMock).toHaveBeenCalledExactlyOnceWith(
        'Add or select a project to create workflows.'
      )
      expect(workflowDeleteMock).not.toHaveBeenCalled()
    })
  })
})
