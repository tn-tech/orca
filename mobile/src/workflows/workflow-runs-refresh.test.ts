import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishDesktopNotification } from '../notifications/desktop-notification-listeners'
import { createCoalescedRefetch, startWorkflowRunsRefresh } from './workflow-runs-refresh'

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
    expect(refetch).toHaveBeenCalledTimes(1)
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
    expect(refetch).toHaveBeenCalledTimes(1)
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

describe('createCoalescedRefetch', () => {
  it('runs one load at a time and folds requests made meanwhile into one more', async () => {
    const releases: (() => void)[] = []
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve)
        })
    )
    const refetch = createCoalescedRefetch(load)

    void refetch()
    void refetch()
    void refetch()
    expect(load).toHaveBeenCalledTimes(1)

    releases[0]?.()
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    releases[1]?.()
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
