import type { Edge, Node, Workflow } from '../../../shared/workflows/workflow-definition-types'
import { evaluateCondition } from '../../../shared/workflows/workflow-condition-evaluation'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { decideJoin, JOIN_SKIPPED_REASON, type IncomingBranch } from './workflow-join-policy'
import { routerChoseEdge } from './workflow-router-choice'

export type FrontierAttempt = Pick<
  NodeAttemptView,
  'nodeId' | 'iteration' | 'attemptIndex' | 'state' | 'resultJson' | 'taskId' | 'failureReason'
>

/**
 * `not-taken`: source completed but the edge condition is false. A Join maps these outcomes onto
 * its own policy (workflow-join-policy.ts), where a skipped branch counts as satisfied.
 */
export type IncomingEdgeOutcome =
  | 'unresolved'
  | 'fired'
  | 'not-taken'
  | 'source-failed'
  | 'source-skipped'

export type FrontierDecision = { eligible: string[]; skipped: string[] }

// Approval/Reflection frontiers land with their own phases; they stay pending here.
// Loop bodies advance per iteration in workflow-loop-unrolling.ts; the Loop node itself is offered here.
export const FRONTIER_NODE_TYPES: ReadonlySet<Node['type']> = new Set<Node['type']>([
  'start',
  'end',
  'agent',
  'router',
  'loop',
  'join'
])

export function nodeTypeOf(nodes: readonly Node[], nodeId: string): Node['type'] | undefined {
  return nodes.find((node) => node.id === nodeId)?.type
}

export function latestAttemptByNode<T extends FrontierAttempt>(
  attempts: readonly T[]
): Map<string, T> {
  const latest = new Map<string, T>()
  for (const attempt of attempts) {
    const current = latest.get(attempt.nodeId)
    if (
      !current ||
      attempt.iteration > current.iteration ||
      (attempt.iteration === current.iteration && attempt.attemptIndex > current.attemptIndex)
    ) {
      latest.set(attempt.nodeId, attempt)
    }
  }
  return latest
}

/** `sourceType` is the type of the node `source` belongs to; a Router's ports are its choices. */
export function incomingEdgeOutcome(
  edge: Edge,
  source: FrontierAttempt | undefined,
  sourceSkipped: boolean,
  sourceType?: Node['type']
): IncomingEdgeOutcome {
  if (sourceSkipped) {
    return 'source-skipped'
  }
  const routerPort = sourceType === 'router'
  // The caller resolves an `exit` edge's source to its Loop's attempt (loopExitSourceId).
  // Approval option ports land with that node type; `body` edges are back-edges the loop
  // unrolling owns.
  if ((edge.fromPort !== undefined && edge.fromPort !== 'exit' && !routerPort) || !source) {
    return 'unresolved'
  }
  switch (source.state) {
    case 'completed':
      return (!routerPort || routerChoseEdge(edge, source.resultJson)) &&
        (!edge.condition || evaluateCondition(edge.condition, source.resultJson))
        ? 'fired'
        : 'not-taken'
    case 'cancelled':
      // A Waiting Join whose branches all ended skipped is cancelled, but reads as skipped.
      return source.failureReason === JOIN_SKIPPED_REASON ? 'source-skipped' : 'source-failed'
    case 'failed':
      return 'source-failed'
    case 'skipped':
      return 'source-skipped'
    case 'pending':
    case 'provisioning':
    case 'running':
    case 'waiting':
    case 'unverifiable':
      return 'unresolved'
  }
}

/**
 * Outcome of one incoming edge; conditions read only the source attempt's result (FR-027).
 * Contract: the controller persists a `skipped` attempt for every `computeFrontier(...).skipped`
 * node (the run view shows Skipped), so skips are read from attempts, never from frontier state.
 * Pass `sourceType` for port edges; without it a Router choice edge reads as unresolved.
 */
export function classifyIncomingEdge(
  edge: Edge,
  attempts: readonly FrontierAttempt[],
  sourceType?: Node['type']
): IncomingEdgeOutcome {
  return incomingEdgeOutcome(edge, latestAttemptByNode(attempts).get(edge.from), false, sourceType)
}

function isBlocked(outcome: IncomingEdgeOutcome): boolean {
  return outcome !== 'fired' && outcome !== 'unresolved'
}

type CandidateVerdict = 'eligible' | 'skipped' | 'waiting'

/**
 * A Join with no attempt is offered to open its Waiting attempt once one branch settled; with a
 * Waiting attempt it is offered again only when its policy settles it.
 */
function joinVerdict(
  kind: ReturnType<typeof decideJoin>['kind'],
  branches: readonly IncomingBranch[],
  hasWaitingAttempt: boolean
): CandidateVerdict {
  if (hasWaitingAttempt) {
    return kind === 'waiting' ? 'waiting' : 'eligible'
  }
  if (kind === 'skip') {
    return 'skipped'
  }
  if (kind === 'waiting') {
    return branches.some((branch) => branch.outcome !== 'unresolved') ? 'eligible' : 'waiting'
  }
  return 'eligible'
}

/** A Join applies its policy; any other merge node behaves like the default Join. */
function candidateVerdict(
  node: Node | undefined,
  branches: readonly IncomingBranch[],
  hasWaitingAttempt: boolean
): CandidateVerdict {
  if (node?.type === 'join') {
    return joinVerdict(decideJoin(node, branches).kind, branches, hasWaitingAttempt)
  }
  const outcomes = branches.map((branch) => branch.outcome)
  if (outcomes.length > 0 && outcomes.every(isBlocked)) {
    return 'skipped'
  }
  return outcomes.includes('fired') && !outcomes.includes('unresolved') ? 'eligible' : 'waiting'
}

/** A Join whose latest attempt is Waiting stays a candidate until its policy settles it. */
export function isWaitingJoin(node: Node, attempt: FrontierAttempt | undefined): boolean {
  return node.type === 'join' && attempt?.state === 'waiting'
}

function loopBodyNodeIds(nodes: readonly Node[]): Set<string> {
  return new Set(nodes.flatMap((node) => (node.type === 'loop' ? node.body.nodeIds : [])))
}

/** An `exit` edge fires when its Loop settles, whether drawn from the Loop or its body. */
export function loopExitSourceId(nodes: readonly Node[], edge: Edge): string {
  if (edge.fromPort !== 'exit') {
    return edge.from
  }
  const loop = nodes.find((node) => node.type === 'loop' && node.body.nodeIds.includes(edge.from))
  return loop?.id ?? edge.from
}

/**
 * Splits candidates into eligible and skipped. Several incoming edges merge like the default Join:
 * eligible once none is unresolved and one fired; skipped only when every edge is blocked. A Join
 * node follows joinVerdict. Skips cascade to a fixpoint. Roots are always eligible.
 */
export function decideCandidates(
  definition: Workflow,
  candidateIds: readonly string[],
  isRoot: (nodeId: string) => boolean,
  branchesFor: (nodeId: string, skipped: ReadonlySet<string>) => IncomingBranch[],
  waitingJoinIds: ReadonlySet<string> = new Set()
): FrontierDecision {
  const verdict = (nodeId: string, skipped: ReadonlySet<string>): CandidateVerdict =>
    isRoot(nodeId)
      ? 'eligible'
      : candidateVerdict(
          definition.nodes.find((node) => node.id === nodeId),
          branchesFor(nodeId, skipped),
          waitingJoinIds.has(nodeId)
        )
  const skipped = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const nodeId of candidateIds) {
      if (!skipped.has(nodeId) && verdict(nodeId, skipped) === 'skipped') {
        skipped.add(nodeId)
        changed = true
      }
    }
  }
  return {
    eligible: candidateIds.filter(
      (nodeId) => !skipped.has(nodeId) && verdict(nodeId, skipped) === 'eligible'
    ),
    skipped: candidateIds.filter((nodeId) => skipped.has(nodeId))
  }
}

/** Incoming branches of a node outside every Loop body; `exit` edges resolve to their Loop. */
export function incomingBranches(
  definition: Workflow,
  latest: ReadonlyMap<string, FrontierAttempt>,
  nodeId: string,
  skipped: ReadonlySet<string> = new Set()
): IncomingBranch[] {
  return definition.edges
    .filter((edge) => edge.to === nodeId && edge.fromPort !== 'body')
    .map((edge) => {
      const sourceId = loopExitSourceId(definition.nodes, edge)
      return {
        sourceId,
        outcome: incomingEdgeOutcome(
          edge,
          latest.get(sourceId),
          skipped.has(sourceId),
          nodeTypeOf(definition.nodes, sourceId)
        )
      }
    })
}

/** Nodes outside every Loop body that have no attempt (or a Waiting Join) and may start now, or can never run. */
export function computeFrontier(
  definition: Workflow,
  attempts: readonly FrontierAttempt[]
): FrontierDecision {
  const latest = latestAttemptByNode(attempts)
  const inLoopBody = loopBodyNodeIds(definition.nodes)
  const waitingJoinIds = new Set(
    definition.nodes.filter((node) => isWaitingJoin(node, latest.get(node.id))).map((n) => n.id)
  )
  const candidates = definition.nodes.filter(
    (node) =>
      FRONTIER_NODE_TYPES.has(node.type) &&
      !inLoopBody.has(node.id) &&
      (!latest.has(node.id) || waitingJoinIds.has(node.id))
  )
  const startIds = new Set(
    candidates.filter((node) => node.type === 'start').map((node) => node.id)
  )
  return decideCandidates(
    definition,
    candidates.map((node) => node.id),
    (nodeId) => startIds.has(nodeId),
    (nodeId, skipped) => incomingBranches(definition, latest, nodeId, skipped),
    waitingJoinIds
  )
}
