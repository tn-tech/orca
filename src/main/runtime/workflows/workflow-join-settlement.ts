// Applies a Join decision (workflow-join-policy.ts). A Join has no worker: its attempt settles the
// moment the frontier offers it, storing `{ branches }` for `${join.branches}` and the run view. A
// Join failed by `onFailure: fail` asks its still-running branches to stop (spec US3 AS3).
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type {
  JoinNode,
  LoopNode,
  Workflow
} from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { incomingBranches, latestAttemptByNode } from './workflow-frontier'
import { decideJoin, type IncomingBranch } from './workflow-join-policy'
import { bodyIncomingBranches } from './workflow-loop-unrolling'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'

const ACTIVE_STATES = new Set<NodeAttemptView['state']>([
  'pending',
  'provisioning',
  'running',
  'waiting',
  'unverifiable'
])

function joinIncomingBranches(
  definition: Workflow,
  attempts: readonly NodeAttemptView[],
  node: JoinNode,
  iteration: number
): IncomingBranch[] {
  const loop = definition.nodes.find(
    (candidate): candidate is LoopNode =>
      candidate.type === 'loop' && candidate.body.nodeIds.includes(node.id)
  )
  return loop
    ? bodyIncomingBranches(definition, loop, attempts, iteration, node.id)
    : incomingBranches(definition, latestAttemptByNode(attempts), node.id)
}

function receiptField(receipt: unknown, key: string): JsonValue {
  const value: unknown =
    typeof receipt === 'object' && receipt !== null ? Reflect.get(receipt, key) : undefined
  return typeof value === 'string' ? value : null
}

/** Only a `stopped` receipt proves the worker is gone; anything else leaves the attempt as is. */
async function stopBranch(
  ctx: WorkflowNodeLaunchContext,
  joinNodeId: string,
  branch: NodeAttemptView
): Promise<void> {
  const payload = { joinNodeId, nodeId: branch.nodeId, dispatchId: branch.dispatchId ?? null }
  const options = { attemptId: branch.id, reason: 'attempt' as const }
  if (!branch.dispatchId) {
    ctx.recorder.event('join_branch_stop_unconfirmed', { ...payload, state: null }, options)
    return
  }
  let receipt: unknown
  try {
    receipt = await ctx.client.call('orchestration.workerStop', { dispatch: branch.dispatchId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.recorder.event('join_branch_stop_failed', { ...payload, error: message }, options)
    return
  }
  const state = receiptField(receipt, 'state')
  if (state === 'stopped') {
    ctx.recorder.transitionAttempt(branch.id, 'cancelled', { reason: 'join_failed', joinNodeId })
    return
  }
  ctx.recorder.event(
    'join_branch_stop_unconfirmed',
    { ...payload, state, lastError: receiptField(receipt, 'lastError') },
    options
  )
}

/** Settles an offered Join: completes it, or fails it and stops its running branches. */
export async function settleJoin(
  ctx: WorkflowNodeLaunchContext,
  node: JoinNode,
  iteration: number
): Promise<void> {
  // Why: re-read, so skips recorded earlier in this advance pass count as settled branches.
  const attempts = ctx.db.listWorkflowAttempts(ctx.recorder.runId)
  const incoming = joinIncomingBranches(ctx.definition, attempts, node, iteration)
  const decision = decideJoin(node, incoming)
  if (decision.kind === 'waiting' || decision.kind === 'skip') {
    throw new Error(`Join ${node.id} was offered while its policy says ${decision.kind}.`)
  }
  const attempt = ctx.recorder.createAttempt(node, iteration)
  ctx.db.updateWorkflowAttempt(attempt.id, { resultJson: { branches: decision.branches } })
  if (decision.kind === 'proceed') {
    for (const state of ['provisioning', 'running', 'completed'] as const) {
      ctx.recorder.transitionAttempt(attempt.id, state)
    }
    return
  }
  ctx.recorder.failBeforeDispatch(attempt.id, decision.reason)
  if (decision.reason !== 'join_branch_failed') {
    return
  }
  const latest = latestAttemptByNode(attempts)
  const running = incoming
    .filter((branch) => branch.outcome === 'unresolved')
    .map((branch) => latest.get(branch.sourceId))
    .filter((branch): branch is NodeAttemptView => !!branch && ACTIVE_STATES.has(branch.state))
  await Promise.all([...new Set(running)].map((branch) => stopBranch(ctx, node.id, branch)))
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
    const join = edge.to === nodeId && joinIds.has(edge.from) ? latest.get(edge.from) : undefined
    const result = join?.state === 'completed' ? join.resultJson : undefined
    if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
      return result.branches
    }
  }
  return undefined
}
