// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ResumeState = {
  repoId: string
  name: string
  source: 'project' | 'user'
  runId: string | null
}

const { storeState } = vi.hoisted(() => {
  const state: {
    workflowsResume: ResumeState | null
    setWorkflowsResume: ReturnType<typeof vi.fn>
  } = { workflowsResume: null, setWorkflowsResume: vi.fn() }
  return { storeState: state }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof storeState) => unknown) => selector(storeState)
}))

import { useWorkflowPageResume } from './use-workflow-page-resume'

const open = vi.fn()
const openRun = vi.fn()

beforeEach(() => {
  storeState.workflowsResume = null
  storeState.setWorkflowsResume.mockReset()
  open.mockReset()
  openRun.mockReset()
})

describe('useWorkflowPageResume', () => {
  it('reopens the remembered workflow and run on mount (F9 remount)', () => {
    storeState.workflowsResume = { repoId: 'repo-1', name: 'wf', source: 'project', runId: 'run-9' }

    renderHook(() =>
      useWorkflowPageResume({ repoId: 'repo-1', openRef: null, runId: null, open, openRun })
    )

    expect(open).toHaveBeenCalledWith({ name: 'wf', source: 'project' })
    expect(openRun).toHaveBeenCalledWith('run-9')
  })

  it('reopens only the workflow when no run was shown', () => {
    storeState.workflowsResume = { repoId: 'repo-1', name: 'wf', source: 'project', runId: null }

    renderHook(() =>
      useWorkflowPageResume({ repoId: 'repo-1', openRef: null, runId: null, open, openRun })
    )

    expect(open).toHaveBeenCalledTimes(1)
    expect(openRun).not.toHaveBeenCalled()
  })

  it('ignores a memory from another project', () => {
    storeState.workflowsResume = { repoId: 'repo-2', name: 'wf', source: 'project', runId: 'run-9' }

    renderHook(() =>
      useWorkflowPageResume({ repoId: 'repo-1', openRef: null, runId: null, open, openRun })
    )

    expect(open).not.toHaveBeenCalled()
    expect(openRun).not.toHaveBeenCalled()
  })

  it('does not wipe the memory before it has been restored', () => {
    storeState.workflowsResume = { repoId: 'repo-1', name: 'wf', source: 'project', runId: 'run-9' }

    renderHook(() =>
      useWorkflowPageResume({ repoId: 'repo-1', openRef: null, runId: null, open, openRun })
    )

    expect(storeState.setWorkflowsResume).not.toHaveBeenCalledWith(null)
  })

  it('remembers the open workflow and shown run as they change', () => {
    type RunProps = { runId: string | null }
    const runProps: RunProps = { runId: null }
    const { rerender } = renderHook(
      (props: RunProps) =>
        useWorkflowPageResume({
          repoId: 'repo-1',
          openRef: { name: 'wf', source: 'project' },
          runId: props.runId,
          open,
          openRun
        }),
      { initialProps: runProps }
    )
    expect(storeState.setWorkflowsResume).toHaveBeenLastCalledWith({
      repoId: 'repo-1',
      name: 'wf',
      source: 'project',
      runId: null
    })

    rerender({ runId: 'run-3' })
    expect(storeState.setWorkflowsResume).toHaveBeenLastCalledWith({
      repoId: 'repo-1',
      name: 'wf',
      source: 'project',
      runId: 'run-3'
    })
  })

  it('forgets the memory once the workflow is closed', () => {
    type Props = { openRef: { name: string; source: 'project' } | null }
    const initialProps: Props = { openRef: { name: 'wf', source: 'project' } }
    const { rerender } = renderHook(
      (props: Props) =>
        useWorkflowPageResume({
          repoId: 'repo-1',
          openRef: props.openRef,
          runId: null,
          open,
          openRun
        }),
      { initialProps }
    )

    rerender({ openRef: null })
    expect(storeState.setWorkflowsResume).toHaveBeenLastCalledWith(null)
  })
})
