// @vitest-environment happy-dom
import { useCallback, useMemo, useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'
import type { WorkflowFileConflictReason } from './editor/FileConflictDialog'

const { workflowValidateMock } = vi.hoisted(() => ({ workflowValidateMock: vi.fn() }))
vi.mock('@/runtime/runtime-workflow-client', () => ({ workflowValidate: workflowValidateMock }))

import { useWorkflowRunSaveGuard } from './use-workflow-run-save-guard'

const settings = { activeRuntimeEnvironmentId: null }

function cleanWorkflow(): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
    layout: {}
  }
}

function workflowWithUnassignedAgent(): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      {
        id: 'agent',
        type: 'agent',
        title: 'Agent',
        prompt: 'do it',
        workspace: 'run',
        resultContract: { type: 'object' },
        artifacts: [],
        question: { timeoutMs: 1, escalationGraceMs: 1 }
      },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'agent' },
      { id: 'e2', from: 'agent', to: 'end' }
    ],
    layout: {}
  }
}

/** Mirrors just enough of `useWorkflowEditorSession`'s state machine (dirty flips false only on a
 *  successful `save()`; `conflict` is externally settable so tests can simulate it arising) to
 *  exercise the guard's post-save timing and conflict coordination without the real session's IPC. */
function useHarness(options: {
  initialDirty: boolean
  initialConflict?: WorkflowFileConflictReason | null
  saveOk: boolean
  definition?: Workflow
  repoId?: string
}) {
  const [dirty, setDirty] = useState(options.initialDirty)
  const [conflict, setConflict] = useState<WorkflowFileConflictReason | null>(
    options.initialConflict ?? null
  )
  const definition = options.definition ?? cleanWorkflow()
  const save = useCallback(async () => {
    const ok = options.saveOk
    if (ok) {
      setDirty(false)
    }
    return ok
  }, [options.saveOk])
  const start = useMemo(() => vi.fn(async () => {}), [])
  const session = useMemo(
    () => ({
      status: 'ready' as const,
      isDraft: false,
      conflict,
      save,
      editor: { state: { dirty, definition } }
    }),
    [conflict, save, dirty, definition]
  )
  const guard = useWorkflowRunSaveGuard({
    session,
    settings,
    repoId: options.repoId ?? 'repo-1',
    start
  })
  return { guard, start, setConflict, setDirty }
}

beforeEach(() => {
  workflowValidateMock.mockReset()
  workflowValidateMock.mockResolvedValue({ problems: [] })
})

describe('useWorkflowRunSaveGuard', () => {
  it('runs immediately when the editor is clean', () => {
    const { result } = renderHook(() => useHarness({ initialDirty: false, saveOk: true }))

    act(() => result.current.guard.requestRun('add tests'))

    expect(result.current.guard.confirmOpen).toBe(false)
    expect(result.current.start).toHaveBeenCalledExactlyOnceWith('add tests')
  })

  it('prompts instead of running the stale on-disk file while the editor is dirty (F8)', () => {
    const { result } = renderHook(() => useHarness({ initialDirty: true, saveOk: true }))

    act(() => result.current.guard.requestRun('add tests'))

    expect(result.current.guard.confirmOpen).toBe(true)
    expect(result.current.start).not.toHaveBeenCalled()
  })

  it('confirming saves first, then runs the saved revision', async () => {
    const { result } = renderHook(() => useHarness({ initialDirty: true, saveOk: true }))
    act(() => result.current.guard.requestRun('add tests'))

    act(() => result.current.guard.confirmSaveAndRun())

    expect(result.current.guard.confirmOpen).toBe(false)
    await waitFor(() => expect(result.current.start).toHaveBeenCalledExactlyOnceWith('add tests'))
    await waitFor(() => expect(result.current.guard.busy).toBe(false))
  })

  it('never runs when the save fails (dirty stays true)', async () => {
    const { result } = renderHook(() => useHarness({ initialDirty: true, saveOk: false }))
    act(() => result.current.guard.requestRun('add tests'))

    act(() => result.current.guard.confirmSaveAndRun())

    await waitFor(() => expect(result.current.guard.busy).toBe(false))
    expect(result.current.start).not.toHaveBeenCalled()
  })

  it('never runs when the saved definition has a local blocking problem (F7 semantics)', async () => {
    const { result } = renderHook(() =>
      useHarness({ initialDirty: true, saveOk: true, definition: workflowWithUnassignedAgent() })
    )
    act(() => result.current.guard.requestRun('add tests'))

    act(() => result.current.guard.confirmSaveAndRun())

    await waitFor(() => expect(result.current.guard.busy).toBe(false))
    expect(result.current.start).not.toHaveBeenCalled()
    expect(workflowValidateMock).not.toHaveBeenCalled()
  })

  it('never runs when the host reports a blocking problem for the saved definition (F7 semantics)', async () => {
    workflowValidateMock.mockResolvedValue({
      problems: [
        {
          code: 'graph_skill_source_not_allowlisted',
          message: 'nope',
          severity: 'error',
          roleId: 'r'
        }
      ]
    })
    const { result } = renderHook(() => useHarness({ initialDirty: true, saveOk: true }))
    act(() => result.current.guard.requestRun('add tests'))

    act(() => result.current.guard.confirmSaveAndRun())

    await waitFor(() => expect(workflowValidateMock).toHaveBeenCalled())
    await waitFor(() => expect(result.current.guard.busy).toBe(false))
    expect(result.current.start).not.toHaveBeenCalled()
  })

  it('cancelling the prompt never saves or runs', () => {
    const { result } = renderHook(() => useHarness({ initialDirty: true, saveOk: true }))
    act(() => result.current.guard.requestRun('add tests'))

    act(() => result.current.guard.cancelSaveAndRun())

    expect(result.current.guard.confirmOpen).toBe(false)
    expect(result.current.start).not.toHaveBeenCalled()
  })

  describe('conflict coordination (F8 fix round 1)', () => {
    it('never opens the prompt when Run is pressed while a conflict already exists', () => {
      const { result } = renderHook(() =>
        useHarness({ initialDirty: true, initialConflict: 'external', saveOk: true })
      )

      act(() => result.current.guard.requestRun('add tests'))

      expect(result.current.guard.confirmOpen).toBe(false)
      expect(result.current.start).not.toHaveBeenCalled()
    })

    it('closes the open prompt the instant a conflict arises, and never reopens it once the conflict clears', () => {
      const { result } = renderHook(() => useHarness({ initialDirty: true, saveOk: true }))
      act(() => result.current.guard.requestRun('add tests'))
      expect(result.current.guard.confirmOpen).toBe(true)

      act(() => result.current.setConflict('external'))
      expect(result.current.guard.confirmOpen).toBe(false)

      // The user resolves the conflict (e.g. reload); the stale prompt must not silently reappear.
      act(() => result.current.setConflict(null))
      expect(result.current.guard.confirmOpen).toBe(false)
      expect(result.current.start).not.toHaveBeenCalled()
    })

    it('never runs when the save itself raises a conflict', async () => {
      const { result } = renderHook(() =>
        useHarness({
          initialDirty: true,
          saveOk: false /* the fake save "fails" like a conflict */
        })
      )
      act(() => result.current.guard.requestRun('add tests'))

      act(() => {
        result.current.guard.confirmSaveAndRun()
        result.current.setConflict('save')
      })

      await waitFor(() => expect(result.current.guard.busy).toBe(false))
      expect(result.current.start).not.toHaveBeenCalled()
      expect(result.current.guard.confirmOpen).toBe(false)
    })
  })

  describe('busy state (F8 fix round 1)', () => {
    it('is busy from "Save and run" until the chain settles, with a "Saving…" reason', async () => {
      let resolveSave!: (ok: boolean) => void
      const savePromise = new Promise<boolean>((resolve) => {
        resolveSave = resolve
      })
      const save = vi.fn(() => savePromise)
      const start = vi.fn(async () => {})
      const session = {
        status: 'ready' as const,
        isDraft: false,
        conflict: null,
        save,
        editor: { state: { dirty: true, definition: cleanWorkflow() } }
      }
      const { result } = renderHook(() =>
        useWorkflowRunSaveGuard({ session, settings, repoId: 'repo-1', start })
      )

      act(() => result.current.requestRun('add tests'))
      act(() => result.current.confirmSaveAndRun())

      expect(result.current.busy).toBe(true)
      expect(result.current.busyReason).toBe('Saving…')

      // A second Run click while busy must not reopen the prompt or fire a second chain.
      act(() => result.current.requestRun('add tests again'))
      expect(result.current.confirmOpen).toBe(false)

      await act(async () => {
        resolveSave(true)
        await savePromise
      })

      await waitFor(() => expect(result.current.busy).toBe(false))
      expect(result.current.busyReason).toBeUndefined()
      expect(start).toHaveBeenCalledExactlyOnceWith('add tests')
    })
  })
})
