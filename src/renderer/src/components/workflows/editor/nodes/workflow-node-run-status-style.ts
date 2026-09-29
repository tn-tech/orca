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
    // Hollow, not filled: the review green is nearly the Completed green (N10).
    case 'waiting':
      return 'border-2 border-workspace-status-progress bg-transparent'
    case 'unverifiable':
      return 'bg-workspace-status-review'
    case 'completed':
      return 'bg-status-success'
    case 'failed':
      return 'bg-destructive'
    // Cancelled (including a Join settled `join_skipped`) is not a failure (review note) — same
    // neutral treatment as `skipped`.
    case 'skipped':
    case 'cancelled':
      return 'bg-muted-foreground'
    case 'pending':
    case undefined:
      return undefined
  }
}
