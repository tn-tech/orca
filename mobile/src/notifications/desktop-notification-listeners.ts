/** A desktop alert that arrived over a host's notification stream, for in-app refreshers. */
export type DesktopNotificationSignal = {
  hostId: string
  /** The desktop's notification source, e.g. `workflow-attention`; absent from older hosts. */
  source: string | undefined
}

type DesktopNotificationListener = (signal: DesktopNotificationSignal) => void

// Why a module registry: the stream is opened once per host by the home connections, and a screen
// that only needs a refetch cue should not open a second stream to the same host.
const listeners = new Set<DesktopNotificationListener>()

export function addDesktopNotificationListener(listener: DesktopNotificationListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishDesktopNotification(signal: DesktopNotificationSignal): void {
  for (const listener of listeners) {
    listener(signal)
  }
}
