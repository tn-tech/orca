// Stops what remains of a Join's branches once the Join failed under `onFailure: fail` (spec US3
// AS3): running workers are asked to stop, and not-yet-started branch nodes are persisted Skipped.
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type {
  JoinNode,
  LoopNode,
  Workflow
} from '../../../shared/workflows/workflow-definition-types'
import { ACTIVE_ATTEMPT_STATES } from '../../../shared/workflows/workflow-node-states'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { latestAttemptByNode, loopExitSourceId } from './workflow-frontier'
import type { IncomingBranch } from './workflow-join-policy'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'

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
      if (ACTIVE_ATTEMPT_STATES.has(attempt.state)) {
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

/** All a worker stop needs from a launch context; the draft teardown builds one without a controller. */
export type WorkerStopContext = Pick<WorkflowNodeLaunchContext, 'recorder' | 'client'>

/** Why a worker is being stopped: events are `<eventPrefix>_failed|_unconfirmed`. */
export type WorkerStopCause = {
  eventPrefix: string
  reason: string
  subject: Record<string, JsonValue>
}

/**
 * Asks the worker to stop; `true` only for a `stopped` receipt, the one proof the worker is gone.
 * Anything else is recorded as `<eventPrefix>_failed|_unconfirmed`, never as an exit.
 */
export async function requestWorkerStop(
  ctx: WorkerStopContext,
  attempt: NodeAttemptView,
  cause: WorkerStopCause
): Promise<boolean> {
  const payload = {
    ...cause.subject,
    nodeId: attempt.nodeId,
    dispatchId: attempt.dispatchId ?? null
  }
  const options = { attemptId: attempt.id, reason: 'attempt' as const }
  if (!attempt.dispatchId) {
    ctx.recorder.event(`${cause.eventPrefix}_unconfirmed`, { ...payload, state: null }, options)
    return false
  }
  let receipt: unknown
  try {
    receipt = await ctx.client.call('orchestration.workerStop', { dispatch: attempt.dispatchId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.recorder.event(`${cause.eventPrefix}_failed`, { ...payload, error: message }, options)
    return false
  }
  const state = receiptField(receipt, 'state')
  if (state === 'stopped') {
    return true
  }
  ctx.recorder.event(
    `${cause.eventPrefix}_unconfirmed`,
    { ...payload, state, lastError: receiptField(receipt, 'lastError') },
    options
  )
  return false
}

/** Cancels the attempt once its worker is proven stopped; otherwise leaves it as is. */
export async function stopWorkerAttempt(
  ctx: WorkerStopContext,
  attempt: NodeAttemptView,
  cause: WorkerStopCause
): Promise<void> {
  if (await requestWorkerStop(ctx, attempt, cause)) {
    ctx.recorder.transitionAttempt(attempt.id, 'cancelled', {
      reason: cause.reason,
      ...cause.subject
    })
  }
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
  const cause = {
    eventPrefix: 'join_branch_stop',
    reason: 'join_failed',
    subject: { joinNodeId: join.id }
  }
  await Promise.all(active.map((branch) => stopWorkerAttempt(ctx, branch, cause)))
}
