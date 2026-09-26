// Loop container execution (data-model.md §4 "Loop", FR-006, FR-028, SC-003). A Loop node has one
// attempt at iteration 0: `running` while it iterates, `completed` when the exit condition holds,
// `failed` with `loop_cap_reached`, `loop_body_failed` or `loop_exit_unreached`. Body nodes get one attempt per
// iteration, tagged with that iteration; bookkeeping is derived from persisted attempts only.
import type { BriefReferenceInputs } from '../../../shared/workflows/workflow-brief-references'
import { evaluateCondition } from '../../../shared/workflows/workflow-condition-evaluation'
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { LoopNode, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import {
  computeFrontier,
  decideCandidates,
  FRONTIER_NODE_TYPES,
  incomingEdgeOutcome,
  latestAttemptByNode,
  type FrontierAttempt,
  type IncomingEdgeOutcome
} from './workflow-frontier'

export type LoopProgressAttempt = FrontierAttempt & Pick<NodeAttemptView, 'id'>

export type IterationNode = { nodeId: string; iteration: number }

/** Iteration `iteration` begins; `exitResult` is the previous iteration's exit-node result. */
export type LoopIterationStart = {
  loopId: string
  attemptId: string
  iteration: number
  exitResult: JsonValue | null
}

export type LoopSettlementOutcome = 'exited' | 'cap_reached' | 'body_failed' | 'exit_unreached'

export type LoopSettlement = {
  loopId: string
  attemptId: string
  outcome: LoopSettlementOutcome
  /** Iterations run so far (1-based count). */
  iterations: number
  /** The last exit-node result, kept on the Loop attempt so the last findings stay visible. */
  exitResult: JsonValue | null
}

export type LoopProgress = {
  eligible: IterationNode[]
  skipped: IterationNode[]
  iterationStarts: LoopIterationStart[]
  settlements: LoopSettlement[]
}

/** What a Loop attempt stores as its result: iteration count and the last exit-node result. */
export type LoopAttemptResult = { iterations: number; exitResult: JsonValue | null }

const TERMINAL_STATES = new Set<FrontierAttempt['state']>([
  'completed',
  'failed',
  'skipped',
  'cancelled'
])

function loops(definition: Workflow): LoopNode[] {
  return definition.nodes.filter((node): node is LoopNode => node.type === 'loop')
}

function currentIteration(loop: LoopNode, attempts: readonly LoopProgressAttempt[]): number {
  const body = new Set(loop.body.nodeIds)
  return attempts
    .filter((attempt) => body.has(attempt.nodeId))
    .reduce((max, attempt) => Math.max(max, attempt.iteration), 0)
}

function iterationAttempts(
  loop: LoopNode,
  attempts: readonly LoopProgressAttempt[],
  iteration: number
): Map<string, FrontierAttempt> {
  const body = new Set(loop.body.nodeIds)
  return latestAttemptByNode(
    attempts.filter((attempt) => body.has(attempt.nodeId) && attempt.iteration === iteration)
  )
}

/** Body nodes of one iteration that may start now or can never run in it. */
function iterationFrontier(
  definition: Workflow,
  loop: LoopNode,
  attempts: readonly LoopProgressAttempt[],
  iteration: number
): { eligible: string[]; skipped: string[] } {
  const body = new Set(loop.body.nodeIds)
  const inIteration = iterationAttempts(loop, attempts, iteration)
  const outside = latestAttemptByNode(attempts)
  // Node types the engine cannot run yet stay pending, exactly as in the main frontier.
  const candidates = loop.body.nodeIds.filter((nodeId) => {
    const type = definition.nodes.find((node) => node.id === nodeId)?.type
    return (
      type !== undefined &&
      type !== 'loop' &&
      FRONTIER_NODE_TYPES.has(type) &&
      !inIteration.has(nodeId)
    )
  })
  const outcomesFor = (nodeId: string, skipped: ReadonlySet<string>): IncomingEdgeOutcome[] => {
    const outcomes = definition.edges
      .filter((edge) => edge.to === nodeId && edge.fromPort !== 'body')
      .map((edge) =>
        body.has(edge.from)
          ? incomingEdgeOutcome(edge, inIteration.get(edge.from), skipped.has(edge.from))
          : incomingEdgeOutcome(edge, outside.get(edge.from), false)
      )
    // The Loop implicitly flows into its entry node at the start of every iteration.
    return nodeId === loop.entryNodeId ? [...outcomes, 'fired'] : outcomes
  }
  return decideCandidates(candidates, () => false, outcomesFor)
}

function isActive(attempt: FrontierAttempt | undefined): boolean {
  return attempt !== undefined && !TERMINAL_STATES.has(attempt.state)
}

/**
 * A quiet iteration whose exit node has no attempt waits only while an outside source feeding an
 * unstarted body node may still settle and the rest of the run is still moving (SC-003).
 */
function mayStillResolve(
  definition: Workflow,
  loop: LoopNode,
  attempts: readonly LoopProgressAttempt[],
  inIteration: ReadonlyMap<string, FrontierAttempt>
): boolean {
  const body = new Set(loop.body.nodeIds)
  const latest = latestAttemptByNode(attempts)
  const waitingOnOutside = definition.edges.some(
    (edge) =>
      body.has(edge.to) &&
      !inIteration.has(edge.to) &&
      !body.has(edge.from) &&
      (latest.get(edge.from) === undefined || isActive(latest.get(edge.from)))
  )
  if (!waitingOnOutside) {
    return false
  }
  const loopIds = new Set(loops(definition).map((candidate) => candidate.id))
  const runMoving = [...latest.values()].some(
    (attempt) => !loopIds.has(attempt.nodeId) && isActive(attempt)
  )
  return runMoving || computeFrontier(definition, attempts).eligible.length > 0
}

function settle(
  loop: LoopNode,
  loopAttemptId: string,
  outcome: LoopSettlementOutcome,
  iteration: number,
  exitResult: JsonValue | null
): LoopSettlement {
  return {
    loopId: loop.id,
    attemptId: loopAttemptId,
    outcome,
    iterations: iteration + 1,
    exitResult
  }
}

function loopProgress(
  definition: Workflow,
  loop: LoopNode,
  loopAttemptId: string,
  attempts: readonly LoopProgressAttempt[],
  progress: LoopProgress
): void {
  const iteration = currentIteration(loop, attempts)
  const inIteration = iterationAttempts(loop, attempts, iteration)
  const frontier = iterationFrontier(definition, loop, attempts, iteration)
  if (frontier.eligible.length > 0 || frontier.skipped.length > 0) {
    progress.eligible.push(...frontier.eligible.map((nodeId) => ({ nodeId, iteration })))
    progress.skipped.push(...frontier.skipped.map((nodeId) => ({ nodeId, iteration })))
    if (inIteration.size === 0 && frontier.eligible.includes(loop.entryNodeId)) {
      progress.iterationStarts.push({
        loopId: loop.id,
        attemptId: loopAttemptId,
        iteration,
        exitResult: null
      })
    }
    return
  }
  if ([...inIteration.values()].some((attempt) => !TERMINAL_STATES.has(attempt.state))) {
    return
  }
  const exit = inIteration.get(loop.exitNodeId)
  const bodyFailed = [...inIteration.values()].some(
    (attempt) => attempt.state === 'failed' || attempt.state === 'cancelled'
  )
  if (bodyFailed) {
    progress.settlements.push(
      settle(loop, loopAttemptId, 'body_failed', iteration, exit?.resultJson ?? null)
    )
    return
  }
  if (!exit || exit.state !== 'completed') {
    // Skipped by an in-body condition, or blocked on an edge that can never resolve.
    if (exit || !mayStillResolve(definition, loop, attempts, inIteration)) {
      progress.settlements.push(settle(loop, loopAttemptId, 'exit_unreached', iteration, null))
    }
    return
  }
  const exitResult = exit.resultJson ?? null
  if (evaluateCondition(loop.exitCondition, exitResult)) {
    progress.settlements.push(settle(loop, loopAttemptId, 'exited', iteration, exitResult))
  } else if (iteration + 1 < loop.maxIterations) {
    progress.eligible.push({ nodeId: loop.entryNodeId, iteration: iteration + 1 })
    progress.iterationStarts.push({
      loopId: loop.id,
      attemptId: loopAttemptId,
      iteration: iteration + 1,
      exitResult
    })
  } else {
    progress.settlements.push(settle(loop, loopAttemptId, 'cap_reached', iteration, exitResult))
  }
}

/**
 * Next steps for every running Loop: body nodes to start or skip in the current iteration, a new
 * iteration at the entry node, or the Loop's settlement once an iteration is quiet. Pure.
 */
export function computeLoopProgress(
  definition: Workflow,
  attempts: readonly LoopProgressAttempt[]
): LoopProgress {
  const progress: LoopProgress = { eligible: [], skipped: [], iterationStarts: [], settlements: [] }
  const latest = latestAttemptByNode(attempts)
  for (const loop of loops(definition)) {
    const loopAttempt = latest.get(loop.id)
    if (loopAttempt?.state === 'running') {
      loopProgress(definition, loop, loopAttempt.id, attempts, progress)
    }
  }
  return progress
}

/**
 * `${loop.previous.<nodeId>}` data for a body node: every body node's completed result from the
 * previous iteration (FR-028). Empty on iteration 0; undefined outside any Loop body.
 */
export function loopPreviousInputs(
  definition: Workflow,
  attempts: readonly FrontierAttempt[],
  nodeId: string,
  iteration: number
): BriefReferenceInputs['loopPrevious'] {
  const loop = loops(definition).find((candidate) => candidate.body.nodeIds.includes(nodeId))
  if (!loop) {
    return undefined
  }
  const body = new Set(loop.body.nodeIds)
  const previous = latestAttemptByNode(
    attempts.filter(
      (attempt) =>
        body.has(attempt.nodeId) &&
        attempt.iteration === iteration - 1 &&
        attempt.state === 'completed' &&
        attempt.resultJson !== undefined
    )
  )
  return Object.fromEntries(
    [...previous].map(([bodyNodeId, attempt]) => [
      bodyNodeId,
      { result: attempt.resultJson ?? null }
    ])
  )
}
