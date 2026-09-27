import { AppState } from 'react-native'
import { admitWorkflowRunChangedEvent } from '../../../src/shared/runtime-client-events'
import { addDesktopNotificationListener } from '../notifications/desktop-notification-listeners'
import type { RpcClient } from '../transport/rpc-client'

const WORKFLOW_ATTENTION_SOURCE = 'workflow-attention'

type WorkflowRunsRefreshArgs = {
  client: Pick<RpcClient, 'subscribe'>
  hostId: string
  /** A run id narrows the refetch to that run; without one, reload the whole list. */
  refetch: (runId: string | undefined) => void
}

function streamMessageType(payload: unknown): unknown {
  return payload && typeof payload === 'object' && 'type' in payload ? payload.type : undefined
}

/** Refetch cues for the run list: `workflowRunChanged` client events, this host's
 *  `workflow-attention` alerts, a stream replay after reconnect, and returning to the foreground. */
export function startWorkflowRunsRefresh({
  client,
  hostId,
  refetch
}: WorkflowRunsRefreshArgs): () => void {
  let stopped = false
  let streamReady = false
  const cue = (runId?: string): void => {
    if (!stopped) {
      refetch(runId)
    }
  }

  const unsubscribeEvents = client.subscribe(
    'runtime.clientEvents.subscribe',
    null,
    (payload: unknown) => {
      const type = streamMessageType(payload)
      if (type === 'ready') {
        // Why: client events are not queued while disconnected, so a replay means we may have missed some.
        if (streamReady) {
          cue()
        }
        streamReady = true
        return
      }
      if (type === 'end' || type === 'error') {
        streamReady = false
        return
      }
      const changed = admitWorkflowRunChangedEvent(payload)
      if (changed) {
        cue(changed.runId)
      }
    }
  )
  const removeNotificationListener = addDesktopNotificationListener((signal) => {
    if (signal.hostId === hostId && signal.source === WORKFLOW_ATTENTION_SOURCE) {
      cue()
    }
  })
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      cue()
    }
  })

  return () => {
    stopped = true
    unsubscribeEvents()
    removeNotificationListener()
    appStateSubscription.remove()
  }
}

/** One pass at a time. Cues landing mid-pass fold into the next: named runs are re-read alone,
 *  and any cue without a run id widens the next pass to a full reload. */
export function createWorkflowRunsRefetcher({
  loadAll,
  loadRuns
}: {
  loadAll: () => Promise<void>
  loadRuns: (runIds: readonly string[]) => Promise<void>
}): (runId?: string) => Promise<void> {
  let reloadAll = false
  const pendingRunIds = new Set<string>()
  let draining: Promise<void> | null = null
  const drain = async (): Promise<void> => {
    try {
      while (reloadAll || pendingRunIds.size > 0) {
        if (reloadAll) {
          reloadAll = false
          pendingRunIds.clear()
          await loadAll()
        } else {
          const runIds = [...pendingRunIds]
          pendingRunIds.clear()
          await loadRuns(runIds)
        }
      }
    } finally {
      draining = null
    }
  }
  return (runId) => {
    if (runId === undefined) {
      reloadAll = true
    } else {
      pendingRunIds.add(runId)
    }
    draining ??= drain()
    return draining
  }
}
