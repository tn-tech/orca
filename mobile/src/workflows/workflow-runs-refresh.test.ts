import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishDesktopNotification } from '../notifications/desktop-notification-listeners'
import { createWorkflowRunsRefetcher, startWorkflowRunsRefresh } from './workflow-runs-refresh'

const appState = vi.hoisted(() => {
  const listeners: ((state: string) => void)[] = []
  return { currentState: 'active', listeners }
})

vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return appState.currentState
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listeners.push(listener)
      return {
        remove: () => {
          appState.listeners = appState.listeners.filter((entry) => entry !== listener)
        }
      }
    }
  }
}))

function fakeClient() {
  let onData: ((payload: unknown) => void) | undefined
  const unsubscribe = vi.fn()
  const subscribe = vi.fn(
    (_method: string, _params: unknown, listener: (payload: unknown) => void) => {
      onData = listener
      return unsubscribe
    }
  )
  return {
    client: { subscribe },
    unsubscribe,
    emit: (payload: unknown) => onData?.(payload)
  }
}

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  stop = undefined
})

describe('startWorkflowRunsRefresh', () => {
  it('opens the client event stream and refetches on workflowRunChanged only', () => {
    const { client, emit } = fakeClient()
    const refetch = vi.fn()
    stop = startWorkflowRunsRefresh({ client, hostId: 'host-a', refetch })

    expect(client.subscribe).toHaveBeenCalledWith(
      'runtime.clientEvents.subscribe',
      null,
      expect.any(Function)
    )
    emit({ type: 'ready', subscriptionId: 'sub-1' })
    emit({ type: 'worktreesChanged', repoId: 'repo' })
    emit({ type: 'workflowRunChanged', runId: '' })
    expect(refetch).not.toHaveBeenCalled()

    emit({ type: 'workflowRunChanged', runId: 'run-1', reason: 'question' })
    expect(refetch.mock.calls).toEqual([['run-1']])
  })

  it('refetches after the stream replays on reconnect, since events are not queued offline', () => {
    const { client, emit } = fakeClient()
    const refetch = vi.fn()
    stop = startWorkflowRunsRefresh({ client, hostId: 'host-a', refetch })
    emit({ type: 'ready', subscriptionId: 'sub-1' })
    expect(refetch).not.toHaveBeenCalled()
    emit({ type: 'ready', subscriptionId: 'sub-2' })
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("refetches on this host's workflow-attention notification and ignores the rest", () => {
    const { client } = fakeClient()
    const refetch = vi.fn()
    stop = startWorkflowRunsRefresh({ client, hostId: 'host-a', refetch })

    publishDesktopNotification({ hostId: 'host-a', source: 'terminal-bell' })
    publishDesktopNotification({ hostId: 'host-b', source: 'workflow-attention' })
    expect(refetch).not.toHaveBeenCalled()

    publishDesktopNotification({ hostId: 'host-a', source: 'workflow-attention' })
    expect(refetch.mock.calls).toEqual([[undefined]])
  })

  it('refetches when the app returns to the foreground', () => {
    const { client } = fakeClient()
    const refetch = vi.fn()
    stop = startWorkflowRunsRefresh({ client, hostId: 'host-a', refetch })
    appState.listeners.forEach((listener) => listener('active'))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('stops listening once stopped', () => {
    const { client, unsubscribe, emit } = fakeClient()
    const refetch = vi.fn()
    startWorkflowRunsRefresh({ client, hostId: 'host-a', refetch })()
    publishDesktopNotification({ hostId: 'host-a', source: 'workflow-attention' })
    emit({ type: 'workflowRunChanged', runId: 'run-1', reason: 'state' })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(appState.listeners).toHaveLength(0)
    expect(refetch).not.toHaveBeenCalled()
  })
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('createWorkflowRunsRefetcher', () => {
  it('refreshes a named run alone, and folds cues made meanwhile into one more pass', async () => {
    const gates: ReturnType<typeof deferred>[] = []
    const loadAll = vi.fn(async () => {})
    const loadRuns = vi.fn((_runIds: readonly string[]) => {
      const gate = deferred()
      gates.push(gate)
      return gate.promise
    })
    const refetch = createWorkflowRunsRefetcher({ loadAll, loadRuns })

    void refetch('run-1')
    void refetch('run-2')
    void refetch('run-3')
    expect(loadRuns.mock.calls).toEqual([[['run-1']]])

    gates[0]?.resolve()
    await vi.waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2))
    expect(loadRuns.mock.calls[1]).toEqual([['run-2', 'run-3']])
    gates[1]?.resolve()
    await vi.waitFor(() => expect(loadAll).not.toHaveBeenCalled())
  })

  it('lets a cue without a run id widen pending work to a full reload', async () => {
    const gate = deferred()
    const loadAll = vi.fn(async () => {})
    const loadRuns = vi.fn(() => gate.promise)
    const refetch = createWorkflowRunsRefetcher({ loadAll, loadRuns })

    void refetch('run-1')
    void refetch('run-2')
    const settled = refetch()
    gate.resolve()
    await settled
    await vi.waitFor(() => expect(loadAll).toHaveBeenCalledTimes(1))
    expect(loadRuns).toHaveBeenCalledTimes(1)
  })

  it('keeps going after a failed pass', async () => {
    const loadAll = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const refetch = createWorkflowRunsRefetcher({ loadAll, loadRuns: vi.fn(async () => {}) })
    await expect(refetch()).rejects.toThrow('boom')
    await refetch()
    expect(loadAll).toHaveBeenCalledTimes(2)
  })
})
