/**
 * A remote-runtime `workflowRunChanged` event must reach the renderer window event with the
 * publishing environment attached — the same attribution automationsChanged carries — not fall
 * through the bridge's unhandled tail (which reads `event.repoId`, undefined for this event, and
 * misroutes it into worktree activation).
 */

import { describe, expect, it, vi } from 'vitest'
import type * as ReactModule from 'react'
import type { RuntimeClientEvent } from '../../../shared/runtime-client-events'
import { WORKFLOWS_CHANGED_EVENT } from '@/lib/workflows-changed-window-event'
import type { WorkflowsChangedWindowDetail } from '@/lib/workflows-changed-window-event'

type Mounted = {
  /** Call inside the test body: useIpcEvents runs its effects eagerly there. */
  useIpcEvents: () => void
  emitRuntimeEvent: (environmentId: string, event: RuntimeClientEvent) => void
  details: () => WorkflowsChangedWindowDetail[]
}

async function mountIpcEvents(): Promise<Mounted> {
  vi.resetModules()
  vi.unstubAllGlobals()
  let onRuntimeEvent: ((environmentId: string, event: RuntimeClientEvent) => void) | null = null
  const dispatchEvent = vi.fn()

  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof ReactModule>('react')
    return { ...actual, useEffect: (effect: () => void | (() => void)) => void effect() }
  })
  vi.doMock('../store', () => ({
    useAppStore: {
      subscribe: vi.fn(() => () => {}),
      getState: () => ({
        settings: { activeRuntimeEnvironmentId: null },
        repos: [],
        worktreesByRepo: {},
        folderWorkspaces: [],
        projectGroups: [],
        tabsByWorktree: {},
        ptyIdsByTabId: {},
        fetchRepos: vi.fn(() => Promise.resolve()),
        fetchProjectGroups: vi.fn(() => Promise.resolve()),
        fetchFolderWorkspaces: vi.fn(() => Promise.resolve())
      })
    }
  }))
  vi.doMock('./runtime-client-events-sync', () => ({
    createRuntimeClientEventsSync: (deps: {
      onEvent: (environmentId: string, event: RuntimeClientEvent) => void
    }) => {
      onRuntimeEvent = deps.onEvent
      return { sync: vi.fn(), stop: vi.fn() }
    }
  }))

  // Why: the hook registers dozens of IPC namespaces at mount; stub the rest so a
  // pending promise keeps unrelated paths dormant instead of failing on store setters.
  const autoStubNamespace = new Proxy(
    {},
    {
      get:
        () =>
        (...args: unknown[]) =>
          typeof args[0] === 'function' ? () => {} : new Promise(() => {})
    }
  )
  const api = new Proxy({}, { get: () => autoStubNamespace })
  vi.stubGlobal('window', {
    api,
    dispatchEvent,
    addEventListener: () => {},
    removeEventListener: () => {}
  })

  const { useIpcEvents } = await import('./useIpcEvents')

  return {
    useIpcEvents,
    emitRuntimeEvent: (environmentId, event) => {
      if (!onRuntimeEvent) {
        throw new Error('Expected the runtime client-event handler to be registered')
      }
      onRuntimeEvent(environmentId, event)
    },
    details: () =>
      dispatchEvent.mock.calls
        .map(([event]) => event)
        .filter(
          (event): event is CustomEvent<WorkflowsChangedWindowDetail> =>
            event instanceof CustomEvent && event.type === WORKFLOWS_CHANGED_EVENT
        )
        .map((event) => event.detail)
  }
}

describe('workflowRunChanged attribution through useIpcEvents', () => {
  it('carries the environment, runId and reason of a runtime-published change', async () => {
    const { useIpcEvents, emitRuntimeEvent, details } = await mountIpcEvents()
    useIpcEvents()

    emitRuntimeEvent('env-1', { type: 'workflowRunChanged', runId: 'run-1', reason: 'attempt' })

    expect(details()).toEqual([{ environmentId: 'env-1', runId: 'run-1', reason: 'attempt' }])
  })

  it('carries a different environment for a second runtime', async () => {
    const { useIpcEvents, emitRuntimeEvent, details } = await mountIpcEvents()
    useIpcEvents()

    emitRuntimeEvent('env-2', { type: 'workflowRunChanged', runId: 'run-2', reason: 'question' })

    expect(details()).toEqual([{ environmentId: 'env-2', runId: 'run-2', reason: 'question' }])
  })
})
