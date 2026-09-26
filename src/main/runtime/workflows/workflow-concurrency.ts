// Per-run concurrency limit (FR-031): a semaphore over worker-dispatching attempts (agent/router/
// reflection). Pure and stateless — every call recounts in-flight attempts from persisted state, so
// a rehydrated run enforces the same budget a live one would (data-model.md workflow_runs
// .concurrency_limit). Structural nodes (start/end/loop/join) settle inline and never hold a slot.
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import { ACTIVE_ATTEMPT_STATES } from '../../../shared/workflows/workflow-node-states'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { IterationNode } from './workflow-loop-unrolling'
import { WORKER_DISPATCH_NODE_TYPES } from './workflow-run-node-launch'

export const DEFAULT_WORKFLOW_CONCURRENCY_LIMIT = 4

/** `overrides.concurrencyLimit` (workflow.run.start) wins; else the workflow file's own value, else the default. */
export function resolveConcurrencyLimit(
  workflow: Pick<Workflow, 'concurrencyLimit'>,
  overrideConcurrencyLimit?: number
): number {
  // Floor of 1: both schemas validate `.positive()`, but a hand-edited or pre-validation
  // snapshot could still carry a stray 0/negative value, which would stall the run forever.
  return Math.max(
    1,
    overrideConcurrencyLimit ?? workflow.concurrencyLimit ?? DEFAULT_WORKFLOW_CONCURRENCY_LIMIT
  )
}

/** Attempts holding a slot right now: not yet terminal, on a worker-dispatching node type. */
export function countInFlightAttempts(
  attempts: readonly Pick<NodeAttemptView, 'nodeType' | 'state'>[]
): number {
  return attempts.filter(
    (attempt) =>
      WORKER_DISPATCH_NODE_TYPES.has(attempt.nodeType) && ACTIVE_ATTEMPT_STATES.has(attempt.state)
  ).length
}

export type ConcurrencyAdmission = { launchable: IterationNode[]; blocked: IterationNode[] }

/**
 * Admits eligible nodes up to the run's remaining budget, in order. A node whose type never
 * dispatches a worker always gets through. A blocked one has no attempt created for it, so it
 * simply reappears as eligible on the next `advanceRun` pass once an in-flight attempt frees a
 * slot — nothing to persist or lose across a restart.
 */
export function admitByConcurrency(
  definition: Workflow,
  eligible: readonly IterationNode[],
  attempts: readonly Pick<NodeAttemptView, 'nodeType' | 'state'>[],
  concurrencyLimit: number
): ConcurrencyAdmission {
  const nodeType = new Map(definition.nodes.map((node) => [node.id, node.type]))
  let budget = Math.max(0, concurrencyLimit - countInFlightAttempts(attempts))
  const launchable: IterationNode[] = []
  const blocked: IterationNode[] = []
  for (const candidate of eligible) {
    const type = nodeType.get(candidate.nodeId)
    if (type === undefined || !WORKER_DISPATCH_NODE_TYPES.has(type)) {
      launchable.push(candidate)
      continue
    }
    if (budget > 0) {
      budget -= 1
      launchable.push(candidate)
    } else {
      blocked.push(candidate)
    }
  }
  return { launchable, blocked }
}
