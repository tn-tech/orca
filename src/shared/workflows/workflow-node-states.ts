/** Workflow run states (data-model.md §3 `workflow_runs.state`, §4 state machine). */
export const WORKFLOW_RUN_STATES = [
  'queued',
  'running',
  'paused',
  'waiting',
  'completed',
  'failed',
  'cancelled'
] as const
export type WorkflowRunState = (typeof WORKFLOW_RUN_STATES)[number]

/** Node attempt states (data-model.md §3 `workflow_node_attempts.state`, §4 state machine). */
export const WORKFLOW_ATTEMPT_STATES = [
  'pending',
  'provisioning',
  'running',
  'waiting',
  'completed',
  'failed',
  'skipped',
  'cancelled',
  'unverifiable'
] as const
export type WorkflowAttemptState = (typeof WORKFLOW_ATTEMPT_STATES)[number]

export type WorkflowStateMachineKind = 'run' | 'attempt'

/**
 * Run transitions (data-model.md §4), plus controller-ruled additions: `paused -> cancelled`
 * (FR-030 lets users cancel any run) and `queued -> cancelled|failed` (host-unreachable refusal
 * before start). Terminal states (completed/failed/cancelled) have no outgoing edges.
 */
const RUN_TRANSITIONS: Record<string, readonly WorkflowRunState[]> = {
  queued: ['running', 'cancelled', 'failed'],
  running: ['paused', 'waiting', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  waiting: ['running', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
}

/**
 * Attempt transitions (data-model.md §4). `unverifiable` is non-terminal: it only follows
 * `running` and only resolves to `running` (recovered) or `failed` (positive proof of exit).
 * Terminal states (completed/failed/skipped/cancelled) have no outgoing edges.
 */
const ATTEMPT_TRANSITIONS: Record<string, readonly WorkflowAttemptState[]> = {
  pending: ['provisioning', 'skipped', 'cancelled'],
  provisioning: ['running', 'cancelled'],
  running: ['waiting', 'completed', 'failed', 'unverifiable', 'cancelled'],
  waiting: ['running', 'cancelled'],
  unverifiable: ['running', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  skipped: [],
  cancelled: []
}

const TRANSITIONS: Record<WorkflowStateMachineKind, Record<string, readonly string[]>> = {
  run: RUN_TRANSITIONS,
  attempt: ATTEMPT_TRANSITIONS
}

export function canTransition(kind: WorkflowStateMachineKind, from: string, to: string): boolean {
  return (TRANSITIONS[kind][from] ?? []).includes(to)
}
