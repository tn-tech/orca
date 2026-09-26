import type { WorkflowAttemptState } from '../../../../../../shared/workflows/workflow-node-states'

/**
 * Maps a node's run attempt state to the existing status tokens (STYLEGUIDE: `--workspace-status-*`,
 * `--status-success*`; no new colors). `undefined` covers plain editing, before any run exists —
 * no dot renders then. The run view (a later unit) supplies the real state per node.
 */
export function workflowNodeStatusDotClassName(
  state: WorkflowAttemptState | undefined
): string | undefined {
  switch (state) {
    case 'provisioning':
    case 'running':
      return 'bg-workspace-status-progress'
    case 'waiting':
    case 'unverifiable':
      return 'bg-workspace-status-review'
    case 'completed':
      return 'bg-status-success'
    case 'failed':
    case 'cancelled':
      return 'bg-destructive'
    case 'skipped':
      return 'bg-muted-foreground'
    case 'pending':
    case undefined:
      return undefined
  }
}
