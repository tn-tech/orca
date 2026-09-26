// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { workflowListMock } = vi.hoisted(() => ({ workflowListMock: vi.fn() }))

vi.mock('@/runtime/runtime-workflow-client', () => ({
  workflowList: workflowListMock
}))

import { useWorkflowListState } from './use-workflow-list-state'

const settings = { activeRuntimeEnvironmentId: null }

beforeEach(() => {
  workflowListMock.mockReset()
})

describe('useWorkflowListState', () => {
  it('fetches the list for the given repo on mount', async () => {
    const rows = [
      { name: 'wf', source: 'project' as const, path: '/repo/wf.workflow.yaml', valid: true }
    ]
    workflowListMock.mockResolvedValue({ workflows: rows })

    const { result } = renderHook(() => useWorkflowListState(settings, 'repo-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(workflowListMock).toHaveBeenCalledWith(settings, 'repo-1')
    expect(result.current.rows).toEqual(rows)
    expect(result.current.error).toBeNull()
  })

  it('does nothing without a repo id', () => {
    const { result } = renderHook(() => useWorkflowListState(settings, undefined))

    expect(workflowListMock).not.toHaveBeenCalled()
    expect(result.current.rows).toEqual([])
  })

  it('surfaces a fetch failure as an error and stops loading', async () => {
    workflowListMock.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useWorkflowListState(settings, 'repo-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('boom')
    expect(result.current.rows).toEqual([])
  })

  it('refresh re-fetches on demand', async () => {
    workflowListMock.mockResolvedValue({ workflows: [] })
    const { result } = renderHook(() => useWorkflowListState(settings, 'repo-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    workflowListMock.mockClear()

    await act(() => result.current.refresh())

    expect(workflowListMock).toHaveBeenCalledTimes(1)
  })
})
