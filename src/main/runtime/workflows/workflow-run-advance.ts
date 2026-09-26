// Drives a run forward until nothing more can start: persists skips, advances Loop iterations,
// settles Loops and Joins, and launches every eligible node (main frontier plus Loop bodies).
import { computeFrontier } from './workflow-frontier'
import {
  computeLoopProgress,
  type IterationNode,
  type LoopAttemptResult,
  type LoopIterationStart,
  type LoopSettlement
} from './workflow-loop-unrolling'
import type { WorkflowResultFailureReason } from './workflow-result-capture'
import { refreshWaitingJoins } from './workflow-join-settlement'
import { launchEligibleNode, type WorkflowNodeLaunchContext } from './workflow-run-node-launch'

const LOOP_FAILURE_REASONS: Record<
  Exclude<LoopSettlement['outcome'], 'exited'>,
  WorkflowResultFailureReason
> = {
  cap_reached: 'loop_cap_reached',
  body_failed: 'loop_body_failed',
  exit_unreached: 'loop_exit_unreached'
}

// Why: the frontier reads skips from persisted attempts; an unrecorded skip reads as unresolved.
function recordSkip(ctx: WorkflowNodeLaunchContext, { nodeId, iteration }: IterationNode): void {
  const node = ctx.definition.nodes.find((candidate) => candidate.id === nodeId)
  if (node) {
    const attempt = ctx.recorder.createAttempt(node, iteration)
    ctx.recorder.transitionAttempt(attempt.id, 'skipped')
  }
}

function recordIterationStart(ctx: WorkflowNodeLaunchContext, start: LoopIterationStart): void {
  const result: LoopAttemptResult = {
    iterations: start.iteration + 1,
    exitResult: start.exitResult
  }
  ctx.db.updateWorkflowAttempt(start.attemptId, { resultJson: result })
  ctx.recorder.event(
    'loop_iteration_started',
    { loopId: start.loopId, iteration: start.iteration },
    { attemptId: start.attemptId, reason: 'attempt' }
  )
}

function settleLoop(ctx: WorkflowNodeLaunchContext, settlement: LoopSettlement): void {
  const result: LoopAttemptResult = {
    iterations: settlement.iterations,
    exitResult: settlement.exitResult
  }
  if (settlement.outcome === 'exited') {
    ctx.db.updateWorkflowAttempt(settlement.attemptId, { resultJson: result })
    ctx.recorder.transitionAttempt(settlement.attemptId, 'completed')
    return
  }
  ctx.db.updateWorkflowAttempt(settlement.attemptId, {
    resultJson: result,
    failureReason: LOOP_FAILURE_REASONS[settlement.outcome]
  })
  ctx.recorder.transitionAttempt(settlement.attemptId, 'failed')
}

/** Loops until the frontier is quiet; the caller then decides whether the run is over. */
export async function advanceRun(ctx: WorkflowNodeLaunchContext): Promise<void> {
  for (;;) {
    const attempts = ctx.db.listWorkflowAttempts(ctx.recorder.runId)
    const frontier = computeFrontier(ctx.definition, attempts)
    const loops = computeLoopProgress(ctx.definition, attempts)
    const skipped = [
      ...frontier.skipped.map((nodeId) => ({ nodeId, iteration: 0 })),
      ...loops.skipped
    ]
    const eligible = [
      ...frontier.eligible.map((nodeId) => ({ nodeId, iteration: 0 })),
      ...loops.eligible
    ]
    if (skipped.length === 0 && eligible.length === 0 && loops.settlements.length === 0) {
      refreshWaitingJoins(ctx)
      return
    }
    for (const node of skipped) {
      recordSkip(ctx, node)
    }
    for (const settlement of loops.settlements) {
      settleLoop(ctx, settlement)
    }
    // Why: Joins settle alone, then the frontier is recomputed, so branch nodes a failed Join
    // skipped are never launched from this pass's stale eligible list.
    const isJoin = ({ nodeId }: IterationNode) =>
      ctx.definition.nodes.some((node) => node.id === nodeId && node.type === 'join')
    const joins = eligible.filter(isJoin)
    for (const { nodeId, iteration } of joins) {
      await launchEligibleNode(ctx, nodeId, attempts, iteration)
    }
    if (joins.length > 0) {
      continue
    }
    for (const start of loops.iterationStarts) {
      recordIterationStart(ctx, start)
    }
    await Promise.all(
      eligible.map(({ nodeId, iteration }) => launchEligibleNode(ctx, nodeId, attempts, iteration))
    )
  }
}
