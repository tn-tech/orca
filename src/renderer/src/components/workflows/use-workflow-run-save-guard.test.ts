// @vitest-environment happy-dom
import { useCallback, useMemo, useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkflowRunSaveGuard } from './use-workflow-run-save-guard'

/** Mirrors just enough of `useWorkflowEditorSession`'s state machine (dirty flips false only on a
 *  successful `save()`) to exercise the guard's post-save timing without the real session's IPC. */
function useHarness(options: {
  initialDirty: boolean
  blockingProblems?: boolean
  saveOk: boolean
}) {
  const [dirty, setDirty] = useState(options.initialDirty)
  const [saving, setSaving] = useState(false)
  const save = useCallback(async () => {
    setSaving(true)
    const ok = options.saveOk
    if (ok) {
      setDirty(false)
    }
    setSaving(false)
    return ok
  }, [options.saveOk])
  const start = useMemo(() => vi.fn(async () => {}), [])
  const session = useMemo(
    () => ({
      status: 'ready' as const,
      isDraft: false,
      saving,
      editor: { state: { dirty } },
      save
    }),
    [saving, dirty, save]
  )
  const guard = useWorkflowRunSaveGuard({
    session,
    blockingProblems: options.blockingProblems ?? false,
    start
  })
  return { guard, start }
}

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
  })

  it('never runs when the save fails (dirty stays true)', async () => {
    const { result } = renderHook(() => useHarness({ initialDirty: true, saveOk: false }))
    act(() => result.current.guard.requestRun('add tests'))

    act(() => result.current.guard.confirmSaveAndRun())

    await waitFor(() => expect(result.current.guard.confirmOpen).toBe(false))
    expect(result.current.start).not.toHaveBeenCalled()
  })

  it('never runs when a blocking problem exists once the save settles (F7 semantics)', async () => {
    const { result } = renderHook(() =>
      useHarness({ initialDirty: true, saveOk: true, blockingProblems: true })
    )
    act(() => result.current.guard.requestRun('add tests'))

    act(() => result.current.guard.confirmSaveAndRun())

    // Give the effect a chance to run; there is nothing to waitFor since nothing should happen.
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.start).not.toHaveBeenCalled()
  })

  it('cancelling the prompt never saves or runs', () => {
    const { result } = renderHook(() => useHarness({ initialDirty: true, saveOk: true }))
    act(() => result.current.guard.requestRun('add tests'))

    act(() => result.current.guard.cancelSaveAndRun())

    expect(result.current.guard.confirmOpen).toBe(false)
    expect(result.current.start).not.toHaveBeenCalled()
  })
})
