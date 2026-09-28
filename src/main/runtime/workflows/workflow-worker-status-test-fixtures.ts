// Agent-status evidence for controller-harness workers, so worker-list's liveness projection sees
// them the way it sees a production agent whose hooks keep publishing.
import type { FleetAgentStatusEvidence } from '../../../shared/orchestration-fleet-agent-status-evidence'

// Why: the worker number keeps parallel workers on distinct panes (one active dispatch per pane).
export function paneKeyFor(handle: string): string {
  const suffix = (/(\d+)$/.exec(handle)?.[1] ?? String(handle.length)).padStart(12, '0')
  return `tab_${handle}:bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`
}

/** A fresh hook-status row per started worker, as a running agent's hooks keep publishing. */
export function reportingStatusEvidence(
  handles: readonly string[],
  worktreeId: string
): FleetAgentStatusEvidence[] {
  return handles.map((handle) => {
    const paneKey = paneKeyFor(handle)
    return {
      binding: {
        kind: 'pane',
        terminalHandle: handle,
        paneKey,
        processIncarnation: `runtime_test:${handle}:1`
      },
      clock: { kind: 'observed', at: Date.now() },
      deliveredAt: Date.now(),
      activity: {
        paneKey,
        connectionId: null,
        state: 'working',
        agentType: 'codex',
        model: null,
        worktreeId,
        restoredUnconfirmed: false,
        providerSessionOnly: false
      }
    }
  })
}
