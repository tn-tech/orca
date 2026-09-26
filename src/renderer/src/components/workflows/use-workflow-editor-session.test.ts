// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'

const { workflowReadMock, workflowWriteMock } = vi.hoisted(() => ({
  workflowReadMock: vi.fn(),
  workflowWriteMock: vi.fn()
}))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowRead: workflowReadMock,
  workflowWrite: workflowWriteMock
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { useWorkflowEditorSession } from './use-workflow-editor-session'

class WorkflowFileConflictError extends Error {
  code = 'workflow_file_conflict'
  constructor() {
    super('workflow_file_conflict')
  }
}

function savedWorkflow(patch: Partial<Workflow> = {}): Workflow {
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
    layout: { start: { x: 0, y: 0 }, end: { x: 320, y: 0 } },
    ...patch
  }
}

const settings = { activeRuntimeEnvironmentId: null }

beforeEach(() => {
  workflowReadMock.mockReset()
  workflowWriteMock.mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('useWorkflowEditorSession', () => {
  it('createNew writes a Start→End definition and opens it', async () => {
    workflowWriteMock.mockResolvedValue({ revision: 'rev-1' })
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))

    await act(() => result.current.createNew('my-flow', 'project'))

    expect(workflowWriteMock).toHaveBeenCalledWith(settings, {
      repo: 'repo-1',
      name: 'my-flow',
      source: 'project',
      definition: expect.objectContaining({ name: 'my-flow' })
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.openRef).toEqual({ name: 'my-flow', source: 'project' })
    expect(result.current.documentRevision).toBe('rev-1')
    expect(result.current.editor.state.definition.nodes.map((n) => n.type)).toEqual([
      'start',
      'end'
    ])
  })

  it('open loads the definition returned by workflow.read', async () => {
    const definition = savedWorkflow()
    workflowReadMock.mockResolvedValue({ definition, raw: 'raw', revision: 'rev-1', problems: [] })
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))

    await act(() => result.current.open({ name: 'wf', source: 'project' }))

    expect(result.current.status).toBe('ready')
    expect(result.current.editor.state.definition).toEqual(definition)
    expect(result.current.editor.state.dirty).toBe(false)
  })

  it('save raises a conflict instead of throwing when the disk revision moved', async () => {
    const definition = savedWorkflow()
    workflowReadMock.mockResolvedValue({ definition, raw: 'raw', revision: 'rev-1', problems: [] })
    workflowWriteMock.mockRejectedValueOnce(new WorkflowFileConflictError())
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))
    await act(() => result.current.open({ name: 'wf', source: 'project' }))

    await act(() => result.current.save())

    expect(result.current.conflict).toBe('save')
    expect(result.current.saving).toBe(false)
  })

  it('save shows a toast and resolves (does not throw) on a non-conflict error', async () => {
    const definition = savedWorkflow()
    workflowReadMock.mockResolvedValue({ definition, raw: 'raw', revision: 'rev-1', problems: [] })
    workflowWriteMock.mockRejectedValueOnce(new Error('disk full'))
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))
    await act(() => result.current.open({ name: 'wf', source: 'project' }))

    await expect(act(() => result.current.save())).resolves.toBeUndefined()

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('disk full')
    expect(result.current.conflict).toBeNull()
    expect(result.current.saving).toBe(false)
  })

  it('overwriteOnDisk shows a toast and resolves (does not throw) on a non-conflict error', async () => {
    const definition = savedWorkflow()
    workflowReadMock.mockResolvedValue({ definition, raw: 'raw', revision: 'rev-1', problems: [] })
    workflowWriteMock.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))
    await act(() => result.current.open({ name: 'wf', source: 'project' }))

    await expect(act(() => result.current.overwriteOnDisk())).resolves.toBeUndefined()

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('network down')
    expect(result.current.conflict).toBeNull()
    expect(result.current.saving).toBe(false)
  })

  it('reloadFromDisk shows a toast and resolves (does not throw) on a read failure', async () => {
    const definition = savedWorkflow()
    workflowReadMock
      .mockResolvedValueOnce({ definition, raw: 'raw', revision: 'rev-1', problems: [] })
      .mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))
    await act(() => result.current.open({ name: 'wf', source: 'project' }))

    await expect(act(() => result.current.reloadFromDisk())).resolves.toBeUndefined()

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('offline')
  })

  it('reloadFromDisk adopts the on-disk copy and clears the conflict', async () => {
    const original = savedWorkflow()
    const updatedOnDisk = savedWorkflow({ description: 'edited by someone else' })
    workflowReadMock
      .mockResolvedValueOnce({ definition: original, raw: 'raw', revision: 'rev-1', problems: [] })
      .mockResolvedValueOnce({
        definition: updatedOnDisk,
        raw: 'raw2',
        revision: 'rev-2',
        problems: []
      })
    workflowWriteMock.mockRejectedValueOnce(new WorkflowFileConflictError())
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))
    await act(() => result.current.open({ name: 'wf', source: 'project' }))
    await act(() => result.current.save())
    expect(result.current.conflict).toBe('save')

    await act(() => result.current.reloadFromDisk())

    expect(result.current.conflict).toBeNull()
    expect(result.current.documentRevision).toBe('rev-2')
    expect(result.current.editor.state.definition.description).toBe('edited by someone else')
  })

  it('overwriteOnDisk re-reads the current revision and writes local edits over it', async () => {
    const original = savedWorkflow()
    workflowReadMock
      .mockResolvedValueOnce({ definition: original, raw: 'raw', revision: 'rev-1', problems: [] })
      .mockResolvedValueOnce({ definition: original, raw: 'raw', revision: 'rev-2', problems: [] })
    workflowWriteMock
      .mockRejectedValueOnce(new WorkflowFileConflictError())
      .mockResolvedValueOnce({ revision: 'rev-3' })
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))
    await act(() => result.current.open({ name: 'wf', source: 'project' }))
    await act(() => result.current.save())
    expect(result.current.conflict).toBe('save')

    await act(() => result.current.overwriteOnDisk())

    expect(result.current.conflict).toBeNull()
    expect(result.current.documentRevision).toBe('rev-3')
    expect(workflowWriteMock).toHaveBeenLastCalledWith(
      settings,
      expect.objectContaining({ expectedRevision: 'rev-2' })
    )
  })

  it('checkForExternalChange silently adopts a newer disk copy when there are no local edits', async () => {
    const original = savedWorkflow()
    const updatedOnDisk = savedWorkflow({ description: 'external edit' })
    workflowReadMock
      .mockResolvedValueOnce({ definition: original, raw: 'raw', revision: 'rev-1', problems: [] })
      .mockResolvedValueOnce({
        definition: updatedOnDisk,
        raw: 'raw2',
        revision: 'rev-2',
        problems: []
      })
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))
    await act(() => result.current.open({ name: 'wf', source: 'project' }))

    await act(() => result.current.checkForExternalChange())

    expect(result.current.conflict).toBeNull()
    expect(result.current.documentRevision).toBe('rev-2')
    expect(result.current.editor.state.definition.description).toBe('external edit')
  })

  it('checkForExternalChange raises a conflict instead of clobbering unsaved local edits', async () => {
    const original = savedWorkflow()
    const updatedOnDisk = savedWorkflow({ description: 'external edit' })
    workflowReadMock
      .mockResolvedValueOnce({ definition: original, raw: 'raw', revision: 'rev-1', problems: [] })
      .mockResolvedValueOnce({
        definition: updatedOnDisk,
        raw: 'raw2',
        revision: 'rev-2',
        problems: []
      })
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))
    await act(() => result.current.open({ name: 'wf', source: 'project' }))
    act(() => {
      result.current.editor.dispatch({
        type: 'update-node',
        node: { id: 'start', type: 'start', title: 'Renamed' }
      })
    })

    await act(() => result.current.checkForExternalChange())

    expect(result.current.conflict).toBe('external')
    // The local edit survives — checkForExternalChange must not overwrite it silently.
    expect(result.current.editor.state.definition.nodes[0].title).toBe('Renamed')
  })

  it('checkForExternalChange does nothing while a save is in flight', async () => {
    const definition = savedWorkflow()
    workflowReadMock.mockResolvedValueOnce({
      definition,
      raw: 'raw',
      revision: 'rev-1',
      problems: []
    })
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))
    await act(() => result.current.open({ name: 'wf', source: 'project' }))

    let resolveWrite!: (value: { revision: string }) => void
    workflowWriteMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveWrite = resolve
      })
    )
    act(() => {
      void result.current.save()
    })
    expect(result.current.saving).toBe(true)
    workflowReadMock.mockClear()

    await act(() => result.current.checkForExternalChange())

    expect(workflowReadMock).not.toHaveBeenCalled()
    expect(result.current.conflict).toBeNull()

    // Drain the pending save so it doesn't leak into another test.
    await act(async () => {
      resolveWrite({ revision: 'rev-2' })
      await Promise.resolve()
    })
  })

  it('close resets the session back to empty', async () => {
    const definition = savedWorkflow()
    workflowReadMock.mockResolvedValue({ definition, raw: 'raw', revision: 'rev-1', problems: [] })
    const { result } = renderHook(() => useWorkflowEditorSession({ settings, repoId: 'repo-1' }))
    await act(() => result.current.open({ name: 'wf', source: 'project' }))

    act(() => result.current.close())

    expect(result.current.status).toBe('empty')
    expect(result.current.openRef).toBeNull()
    expect(result.current.documentRevision).toBeNull()
  })
})
