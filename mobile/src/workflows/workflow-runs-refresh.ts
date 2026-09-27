import { AppState } from 'react-native'
import { admitWorkflowRunChangedEvent } from '../../../src/shared/runtime-client-events'
import { addDesktopNotificationListener } from '../notifications/desktop-notification-listeners'
import type { RpcClient } from '../transport/rpc-client'

const WORKFLOW_ATTENTION_SOURCE = 'workflow-attention'

type WorkflowRunsRefreshArgs = {
  client: Pick<RpcClient, 'subscribe'>
  hostId: string
  refetch: () => void
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
  const cue = (): void => {
    if (!stopped) {
      refetch()
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
      if (admitWorkflowRunChangedEvent(payload)) {
        cue()
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

/** One load at a time; cues that land mid-load fold into a single follow-up load. */
export function createCoalescedRefetch(load: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null
  let queued = false
  const run = async (): Promise<void> => {
    try {
      await load()
    } finally {
      inFlight = null
      if (queued) {
        queued = false
        inFlight = run()
      }
    }
  }
  return () => {
    if (inFlight) {
      queued = true
      return inFlight
    }
    inFlight = run()
    return inFlight
  }
}
