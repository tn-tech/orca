// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkRuntimeHooksMock } = vi.hoisted(() => ({ checkRuntimeHooksMock: vi.fn() }))

vi.mock('@/runtime/runtime-hooks-client', () => ({
  checkRuntimeHooks: checkRuntimeHooksMock
}))

import { useWorkflowSourceAllowlist } from './use-workflow-source-allowlist'

const settings = { activeRuntimeEnvironmentId: null }

beforeEach(() => {
  checkRuntimeHooksMock.mockReset()
})

describe('useWorkflowSourceAllowlist (FR-015a)', () => {
  it('starts unknown (undefined), not empty, so nothing is flagged while loading', () => {
    checkRuntimeHooksMock.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useWorkflowSourceAllowlist(settings, 'repo-1'))

    expect(result.current).toBeUndefined()
  })

  it('resolves to the project allowlist read from orca.yaml via the shared hooks client', async () => {
    checkRuntimeHooksMock.mockResolvedValue({
      hasHooks: true,
      hooks: { scripts: {}, workflows: { allowedSources: ['https://example.com/allowed'] } },
      mayNeedUpdate: false
    })

    const { result } = renderHook(() => useWorkflowSourceAllowlist(settings, 'repo-1'))

    await waitFor(() => expect(result.current).toEqual(['https://example.com/allowed']))
    expect(checkRuntimeHooksMock).toHaveBeenCalledWith(settings, 'repo-1')
  })

  it('stays undefined (unknown) when orca.yaml has no workflows block', async () => {
    checkRuntimeHooksMock.mockResolvedValue({
      hasHooks: true,
      hooks: { scripts: {} },
      mayNeedUpdate: false
    })

    const { result } = renderHook(() => useWorkflowSourceAllowlist(settings, 'repo-1'))

    await waitFor(() => expect(checkRuntimeHooksMock).toHaveBeenCalled())
    expect(result.current).toBeUndefined()
  })

  it('stays undefined (unknown), never falls back to an empty allowlist, when the read fails', async () => {
    checkRuntimeHooksMock.mockRejectedValue(new Error('runtime_unavailable'))

    const { result } = renderHook(() => useWorkflowSourceAllowlist(settings, 'repo-1'))

    await waitFor(() => expect(checkRuntimeHooksMock).toHaveBeenCalled())
    expect(result.current).toBeUndefined()
  })

  it('does nothing without a repo id', () => {
    const { result } = renderHook(() => useWorkflowSourceAllowlist(settings, undefined))

    expect(checkRuntimeHooksMock).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })
})
