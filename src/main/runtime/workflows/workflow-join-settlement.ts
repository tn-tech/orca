// Applies a Join decision (workflow-join-policy.ts). A Join has no worker: its attempt stores
// `{ branches }` for `${join.branches}` and the run view, and settles when its policy does.
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { JoinNode, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { incomingBranches, latestAttemptByNode } from './workflow-frontier'
import { containingLoop, stopRemainingBranches } from './workflow-join-branch-stop'
import {
  decideJoin,
  JOIN_SKIPPED_REASON,
  joinBranchOutcomes,
  type IncomingBranch
} from './workflow-join-policy'
import { bodyIncomingBranches } from './workflow-loop-unrolling'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'

function joinIncomingBranches(
  definition: Workflow,
  attempts: readonly NodeAttemptView[],
  node: JoinNode,
  iteration: number
): IncomingBranch[] {
  const loop = containingLoop(definition, node.id)
  return loop
    ? bodyIncomingBranches(definition, loop, attempts, iteration, node.id)
    : incomingBranches(definition, latestAttemptByNode(attempts), node.id)
}

/**
 * Settles an offered Join. The first settled branch opens its attempt in Waiting (FR-032, US3 AS2);
 * the policy then completes or fails it. A Waiting Join whose branches all end up skipped is
 * cancelled, since a Waiting attempt cannot become Skipped.
 */
export async function settleJoin(
  ctx: WorkflowNodeLaunchContext,
  node: JoinNode,
  iteration: number
): Promise<void> {
  // Why: re-read, so skips recorded earlier in this advance pass count as settled branches.
  const attempts = ctx.db.listWorkflowAttempts(ctx.recorder.runId)
  const incoming = joinIncomingBranches(ctx.definition, attempts, node, iteration)
  const decision = decideJoin(node, incoming)
  const waiting = attempts.find(
    (a) => a.nodeId === node.id && a.iteration === iteration && a.state === 'waiting'
  )
  if (decision.kind === 'skip') {
    if (!waiting) {
      throw new Error(`Join ${node.id} was offered while its policy says skip.`)
    }
    ctx.db.updateWorkflowAttempt(waiting.id, { failureReason: JOIN_SKIPPED_REASON })
    ctx.recorder.transitionAttempt(waiting.id, 'cancelled', { reason: JOIN_SKIPPED_REASON })
    return
  }
  let attemptId = waiting?.id
  if (!attemptId) {
    attemptId = ctx.recorder.createAttempt(node, iteration).id
    ctx.recorder.transitionAttempt(attemptId, 'provisioning')
  }
  const branches =
    decision.kind === 'waiting' ? joinBranchOutcomes(node, incoming) : decision.branches
  ctx.db.updateWorkflowAttempt(attemptId, { resultJson: { branches } })
  if (decision.kind === 'waiting') {
    if (!waiting) {
      ctx.recorder.transitionAttempt(attemptId, 'waiting')
    }
    return
  }
  ctx.recorder.transitionAttempt(attemptId, 'running')
  if (decision.kind === 'proceed') {
    ctx.recorder.transitionAttempt(attemptId, 'completed')
    return
  }
  ctx.db.updateWorkflowAttempt(attemptId, { failureReason: decision.reason })
  ctx.recorder.transitionAttempt(attemptId, 'failed')
  if (node.onFailure === 'fail') {
    await stopRemainingBranches(ctx, node, iteration, attempts, incoming)
  }
}

/** Keeps each Waiting Join's `branches` current for the run view while it waits. */
export function refreshWaitingJoins(ctx: WorkflowNodeLaunchContext): void {
  const attempts = ctx.db.listWorkflowAttempts(ctx.recorder.runId)
  for (const attempt of attempts) {
    const node = ctx.definition.nodes.find((candidate) => candidate.id === attempt.nodeId)
    if (attempt.state !== 'waiting' || node?.type !== 'join') {
      continue
    }
    const incoming = joinIncomingBranches(ctx.definition, attempts, node, attempt.iteration)
    const resultJson = { branches: joinBranchOutcomes(node, incoming) }
    if (JSON.stringify(resultJson) !== JSON.stringify(attempt.resultJson)) {
      const { branches } = resultJson
      ctx.db.updateWorkflowAttempt(attempt.id, { resultJson })
      ctx.recorder.event(
        'join_branches_updated',
        { nodeId: node.id, branches },
        {
          attemptId: attempt.id,
          reason: 'attempt'
        }
      )
    }
  }
}

/** `${join.branches}` for a node fed directly by a completed Join. */
export function joinBranchesInput(
  definition: Workflow,
  attempts: readonly NodeAttemptView[],
  nodeId: string
): JsonValue | undefined {
  const joinIds = new Set(
    definition.nodes.filter((node) => node.type === 'join').map((node) => node.id)
  )
  const latest = latestAttemptByNode(attempts)
  for (const edge of definition.edges) {
    const fromJoin = edge.to === nodeId && edge.fromPort !== 'body' && joinIds.has(edge.from)
    const join = fromJoin ? latest.get(edge.from) : undefined
    const result = join?.state === 'completed' ? join.resultJson : undefined
    if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
      return result.branches
    }
  }
  return undefined
}
