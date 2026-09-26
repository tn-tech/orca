// Join node policy (data-model.md §4 "Join", FR-007): `all` / `any` / `quorum(n)` over incoming
// branch outcomes, with `onFailure` fail / skip / partial. Pure; the engine applies the decision in
// workflow-join-settlement.ts.
import type { JoinNode } from '../../../shared/workflows/workflow-definition-types'
import type { IncomingEdgeOutcome } from './workflow-frontier'
import type { WorkflowResultFailureReason } from './workflow-result-capture'

/** One incoming edge of a node, keyed by the node that settles it (a Loop for `exit` edges). */
export type IncomingBranch = { sourceId: string; outcome: IncomingEdgeOutcome }

/** `failureReason` of a Waiting Join cancelled because every branch ended skipped. */
export const JOIN_SKIPPED_REASON = 'join_skipped'

export type JoinBranchOutcome = 'completed' | 'failed' | 'skipped' | 'pending'

/** `${join.branches}`: per-branch outcome keyed by source node id. */
export type JoinBranches = Record<string, JoinBranchOutcome>

export type JoinFailureReason = Extract<
  WorkflowResultFailureReason,
  'join_branch_failed' | 'join_unsatisfied'
>

export type JoinDecision =
  | { kind: 'waiting' }
  | { kind: 'skip' }
  | { kind: 'proceed'; branches: JoinBranches }
  | { kind: 'fail'; reason: JoinFailureReason; branches: JoinBranches }

function branchOutcome(
  outcome: IncomingEdgeOutcome,
  onFailure: JoinNode['onFailure']
): JoinBranchOutcome {
  switch (outcome) {
    case 'fired':
      return 'completed'
    case 'unresolved':
      return 'pending'
    case 'not-taken':
    case 'source-skipped':
      return 'skipped'
    case 'source-failed':
      return onFailure === 'skip' ? 'skipped' : 'failed'
  }
}

export function joinBranchOutcomes(
  node: JoinNode,
  incoming: readonly IncomingBranch[]
): JoinBranches {
  return Object.fromEntries(
    incoming.map((branch) => [branch.sourceId, branchOutcome(branch.outcome, node.onFailure)])
  )
}

export function decideJoin(node: JoinNode, incoming: readonly IncomingBranch[]): JoinDecision {
  const outcomes = incoming.map((branch) => branchOutcome(branch.outcome, node.onFailure))
  const branches = joinBranchOutcomes(node, incoming)
  const count = (outcome: JoinBranchOutcome) => outcomes.filter((o) => o === outcome).length
  const completed = count('completed')
  const failed = count('failed')
  const pending = count('pending')
  if (node.onFailure === 'fail' && failed > 0) {
    return { kind: 'fail', reason: 'join_branch_failed', branches }
  }
  if (node.policy === 'all') {
    // Every branch settled; skipped (and, under `partial`, failed) branches satisfy it.
    if (pending > 0) {
      return { kind: 'waiting' }
    }
    if (completed > 0) {
      return { kind: 'proceed', branches }
    }
  } else {
    const required = node.policy === 'any' ? 1 : node.policy.quorum
    if (completed >= required) {
      return { kind: 'proceed', branches }
    }
    if (completed + pending >= required) {
      return { kind: 'waiting' }
    }
  }
  // Out of reach: skipped only when no branch did any work; otherwise the policy is unsatisfied.
  return failed + completed > 0
    ? { kind: 'fail', reason: 'join_unsatisfied', branches }
    : { kind: 'skip' }
}
