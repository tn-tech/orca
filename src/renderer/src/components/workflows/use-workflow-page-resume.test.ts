// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ResumeState = {
  repoId: string
  name: string
  source: 'project'
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

vi.mock('sonner', () => ({ toast: { message: (...args: unknown[]) => toastMessage(...args) } }))

import { useWorkflowPageResume } from './use-workflow-page-resume'

const open = vi.fn()
const openRun = vi.fn()

beforeEach(() => {
  storeState.workflowsResume = null
  storeState.setWorkflowsResume.mockReset()
  open.mockReset()
  dropRun.mockReset()
  toastMessage.mockReset()
  openRun.mockReset()
})

const dropRun = vi.fn()
const toastMessage = vi.fn()

type HookProps = {
  repoId: string | undefined
  openRef: { name: string; source: 'project' } | null
  runId: string | null
  runLoadFailed: boolean
}

function render(initial: Partial<HookProps> = {}) {
  const initialProps: HookProps = {
    repoId: 'repo-1',
    openRef: null,
    runId: null,
    runLoadFailed: false,
    ...initial
  }
  return renderHook(
    (props: HookProps) => useWorkflowPageResume({ ...props, open, openRun, dropRun }),
    { initialProps }
  )
}

describe('useWorkflowPageResume', () => {
  it('reopens the remembered workflow and run on mount (F9 remount)', () => {
    storeState.workflowsResume = { repoId: 'repo-1', name: 'wf', source: 'project', runId: 'run-9' }

    render()

    expect(open).toHaveBeenCalledWith({ name: 'wf', source: 'project' })
    expect(openRun).toHaveBeenCalledWith('run-9')
  })

  it('reopens only the workflow when no run was shown', () => {
    storeState.workflowsResume = { repoId: 'repo-1', name: 'wf', source: 'project', runId: null }

    render()

    expect(open).toHaveBeenCalledTimes(1)
    expect(openRun).not.toHaveBeenCalled()
  })

  it('ignores a memory from another project', () => {
    storeState.workflowsResume = { repoId: 'repo-2', name: 'wf', source: 'project', runId: 'run-9' }

    render()

    expect(open).not.toHaveBeenCalled()
    expect(openRun).not.toHaveBeenCalled()
  })

  it('clears the memory once it has been consumed, so a failed restore is not retried on every visit', () => {
    storeState.workflowsResume = { repoId: 'repo-1', name: 'wf', source: 'project', runId: 'run-9' }

    render()

    expect(open).toHaveBeenCalledTimes(1)
    expect(storeState.setWorkflowsResume).toHaveBeenCalledWith(null)
  })

  it('drops a restored run that fails to load and says so quietly', () => {
    storeState.workflowsResume = { repoId: 'repo-1', name: 'wf', source: 'project', runId: 'run-9' }
    const { rerender } = render()

    rerender({
      repoId: 'repo-1',
      openRef: { name: 'wf', source: 'project' },
      runId: 'run-9',
      runLoadFailed: true
    })

    expect(dropRun).toHaveBeenCalledTimes(1)
    expect(toastMessage).toHaveBeenCalledTimes(1)
  })

  it('leaves a run the user opened themselves alone when it fails to load', () => {
    const { rerender } = render({ openRef: { name: 'wf', source: 'project' } })

    rerender({
      repoId: 'repo-1',
      openRef: { name: 'wf', source: 'project' },
      runId: 'run-3',
      runLoadFailed: true
    })

    expect(dropRun).not.toHaveBeenCalled()
  })

  it('remembers the open workflow and shown run as they change', () => {
    const openRef = { name: 'wf', source: 'project' as const }
    const { rerender } = render({ openRef })
    expect(storeState.setWorkflowsResume).toHaveBeenLastCalledWith({
      repoId: 'repo-1',
      name: 'wf',
      source: 'project',
      runId: null
    })

    rerender({ repoId: 'repo-1', openRef, runId: 'run-3', runLoadFailed: false })
    expect(storeState.setWorkflowsResume).toHaveBeenLastCalledWith({
      repoId: 'repo-1',
      name: 'wf',
      source: 'project',
      runId: 'run-3'
    })
  })

  it('keeps the memory under the project the workflow was opened in after a project switch', () => {
    const openRef = { name: 'wf', source: 'project' as const }
    const { rerender } = render({ openRef, runId: 'run-9' })

    rerender({ repoId: 'repo-2', openRef, runId: 'run-9', runLoadFailed: false })

    expect(storeState.setWorkflowsResume).not.toHaveBeenCalledWith(
      expect.objectContaining({ repoId: 'repo-2' })
    )
    expect(storeState.setWorkflowsResume).toHaveBeenLastCalledWith({
      repoId: 'repo-1',
      name: 'wf',
      source: 'project',
      runId: 'run-9'
    })
  })

  it('files a workflow newly opened after a project switch under the new project', () => {
    const first = { name: 'wf', source: 'project' as const }
    const { rerender } = render({ openRef: first, runId: 'run-9' })
    rerender({ repoId: 'repo-2', openRef: first, runId: 'run-9', runLoadFailed: false })

    rerender({
      repoId: 'repo-2',
      openRef: { name: 'wf', source: 'project' },
      runId: null,
      runLoadFailed: false
    })

    expect(storeState.setWorkflowsResume).toHaveBeenLastCalledWith({
      repoId: 'repo-2',
      name: 'wf',
      source: 'project',
      runId: null
    })
  })

  it('forgets the memory once the workflow is closed', () => {
    const { rerender } = render({ openRef: { name: 'wf', source: 'project' } })

    rerender({ repoId: 'repo-1', openRef: null, runId: null, runLoadFailed: false })
    expect(storeState.setWorkflowsResume).toHaveBeenLastCalledWith(null)
  })
})
