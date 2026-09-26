// Stops what remains of a Join's branches once the Join failed under `onFailure: fail` (spec US3
// AS3): running workers are asked to stop, and not-yet-started branch nodes are persisted Skipped.
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type {
  JoinNode,
  LoopNode,
  Workflow
} from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { latestAttemptByNode, loopExitSourceId } from './workflow-frontier'
import type { IncomingBranch } from './workflow-join-policy'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'

const ACTIVE_STATES = new Set<NodeAttemptView['state']>([
  'pending',
  'provisioning',
  'running',
  'waiting',
  'unverifiable'
])

export function containingLoop(definition: Workflow, nodeId: string): LoopNode | undefined {
  return definition.nodes.find(
    (node): node is LoopNode => node.type === 'loop' && node.body.nodeIds.includes(nodeId)
  )
}

/**
 * Walks back from the Join's pending inputs through nodes with no attempt, within the Join's own
 * scope (the main graph, or the Join's Loop iteration); stops at nodes that already have one.
 */
export function remainingBranchNodes(
  definition: Workflow,
  attempts: readonly NodeAttemptView[],
  join: JoinNode,
  iteration: number,
  incoming: readonly IncomingBranch[]
): { unstarted: string[]; active: NodeAttemptView[] } {
  const loop = containingLoop(definition, join.id)
  const inScope = (nodeId: string) =>
    loop ? loop.body.nodeIds.includes(nodeId) : containingLoop(definition, nodeId) === undefined
  const latest = latestAttemptByNode(
    loop ? attempts.filter((a) => inScope(a.nodeId) && a.iteration === iteration) : attempts
  )
  const queue = incoming.filter((b) => b.outcome === 'unresolved').map((b) => b.sourceId)
  const visited = new Set<string>()
  const unstarted: string[] = []
  const active: NodeAttemptView[] = []
  for (let nodeId = queue.shift(); nodeId !== undefined; nodeId = queue.shift()) {
    if (visited.has(nodeId) || !inScope(nodeId)) {
      continue
    }
    visited.add(nodeId)
    const attempt = latest.get(nodeId)
    if (attempt) {
      if (ACTIVE_STATES.has(attempt.state)) {
        active.push(attempt)
      }
      continue
    }
    unstarted.push(nodeId)
    for (const edge of definition.edges) {
      if (edge.to === nodeId && edge.fromPort !== 'body') {
        queue.push(loop ? edge.from : loopExitSourceId(definition.nodes, edge))
      }
    }
  }
  return { unstarted, active }
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

/**
 * Unstarted branch nodes become Skipped, not Cancelled: they never ran, and Skipped is what the
 * frontier already reads as "can never run", so nothing downstream waits on them.
 */
export async function stopRemainingBranches(
  ctx: WorkflowNodeLaunchContext,
  join: JoinNode,
  iteration: number,
  attempts: readonly NodeAttemptView[],
  incoming: readonly IncomingBranch[]
): Promise<void> {
  const { unstarted, active } = remainingBranchNodes(
    ctx.definition,
    attempts,
    join,
    iteration,
    incoming
  )
  for (const nodeId of unstarted) {
    const node = ctx.definition.nodes.find((candidate) => candidate.id === nodeId)
    if (node) {
      const attempt = ctx.recorder.createAttempt(node, iteration)
      ctx.recorder.transitionAttempt(attempt.id, 'skipped', {
        reason: 'join_failed',
        joinNodeId: join.id
      })
    }
  }
  await Promise.all(active.map((branch) => stopBranch(ctx, join.id, branch)))
}
