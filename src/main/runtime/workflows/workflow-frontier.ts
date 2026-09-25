import type { Edge, Node, Workflow } from '../../../shared/workflows/workflow-definition-types'
import { evaluateCondition } from '../../../shared/workflows/workflow-condition-evaluation'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { WorkflowOrchestrationClient } from './workflow-orchestration-client'

export type FrontierAttempt = Pick<
  NodeAttemptView,
  'nodeId' | 'iteration' | 'attemptIndex' | 'state' | 'resultJson' | 'taskId'
>

/**
 * `not-taken`: source completed but the edge condition is false. Join (US3) maps these outcomes
 * onto its own policy, where a skipped branch counts as satisfied.
 */
export type IncomingEdgeOutcome =
  | 'unresolved'
  | 'fired'
  | 'not-taken'
  | 'source-failed'
  | 'source-skipped'

export type FrontierDecision = { eligible: string[]; skipped: string[] }

// Router/Loop/Join/Approval/Reflection frontiers land with their own phases; they stay pending here.
const FRONTIER_NODE_TYPES = new Set<Node['type']>(['start', 'end', 'agent'])

function latestAttemptByNode(attempts: readonly FrontierAttempt[]): Map<string, FrontierAttempt> {
  const latest = new Map<string, FrontierAttempt>()
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

function edgeOutcome(
  edge: Edge,
  source: FrontierAttempt | undefined,
  sourceSkipped: boolean
): IncomingEdgeOutcome {
  if (sourceSkipped) {
    return 'source-skipped'
  }
  // Port selection (router choice, approval option, loop body/exit) lands with those node types.
  if (edge.fromPort !== undefined || !source) {
    return 'unresolved'
  }
  switch (source.state) {
    case 'completed':
      return !edge.condition || evaluateCondition(edge.condition, source.resultJson)
        ? 'fired'
        : 'not-taken'
    case 'failed':
    case 'cancelled':
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

/** Outcome of one incoming edge; conditions read only the source attempt's result (FR-027). */
export function classifyIncomingEdge(
  edge: Edge,
  attempts: readonly FrontierAttempt[]
): IncomingEdgeOutcome {
  return edgeOutcome(edge, latestAttemptByNode(attempts).get(edge.from), false)
}

function loopBodyNodeIds(nodes: readonly Node[]): Set<string> {
  return new Set(nodes.flatMap((node) => (node.type === 'loop' ? node.body.nodeIds : [])))
}

/**
 * Nodes without an attempt that may start now, and nodes that can never run. A non-Join node needs
 * every incoming edge fired, so one blocked edge skips it; skips cascade to a fixpoint.
 */
export function computeFrontier(
  definition: Workflow,
  attempts: readonly FrontierAttempt[]
): FrontierDecision {
  const latest = latestAttemptByNode(attempts)
  const inLoopBody = loopBodyNodeIds(definition.nodes)
  const candidates = definition.nodes.filter(
    (node) => FRONTIER_NODE_TYPES.has(node.type) && !inLoopBody.has(node.id) && !latest.has(node.id)
  )
  const incoming = (nodeId: string): Edge[] => definition.edges.filter((edge) => edge.to === nodeId)
  const skipped = new Set<string>()
  const outcomesFor = (nodeId: string): IncomingEdgeOutcome[] =>
    incoming(nodeId).map((edge) => edgeOutcome(edge, latest.get(edge.from), skipped.has(edge.from)))

  let changed = true
  while (changed) {
    changed = false
    for (const node of candidates) {
      if (node.type === 'start' || skipped.has(node.id)) {
        continue
      }
      if (outcomesFor(node.id).some((outcome) => outcome !== 'fired' && outcome !== 'unresolved')) {
        skipped.add(node.id)
        changed = true
      }
    }
  }

  const eligible = candidates
    .filter((node) => {
      if (node.type === 'start') {
        return true
      }
      const outcomes = outcomesFor(node.id)
      return (
        !skipped.has(node.id) &&
        outcomes.length > 0 &&
        outcomes.every((outcome) => outcome === 'fired')
      )
    })
    .map((node) => node.id)
  return {
    eligible,
    skipped: candidates.filter((node) => skipped.has(node.id)).map((node) => node.id)
  }
}

export type WorkflowTaskPort = Pick<WorkflowOrchestrationClient, 'call'>

function taskIdFromResult(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) {
    return undefined
  }
  const task: unknown = Reflect.get(result, 'task')
  if (typeof task !== 'object' || task === null) {
    return undefined
  }
  const id: unknown = Reflect.get(task, 'id')
  return typeof id === 'string' ? id : undefined
}

/**
 * Just-in-time Task for an eligible node (research R3): `deps` records upstream Tasks; the host
 * stamps workflow_run_id from the engine principal and node id/iteration from these params.
 */
export async function createNodeTask(
  port: WorkflowTaskPort,
  args: {
    definition: Workflow
    attempts: readonly FrontierAttempt[]
    nodeId: string
    iteration: number
    spec: string
  }
): Promise<string> {
  const node = args.definition.nodes.find((candidate) => candidate.id === args.nodeId)
  if (!node) {
    throw new Error(`Workflow node ${args.nodeId} is not in the run's definition.`)
  }
  const latest = latestAttemptByNode(args.attempts)
  const deps = args.definition.edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => latest.get(edge.from)?.taskId)
    .filter((taskId): taskId is string => taskId !== undefined)
  const result = await port.call('orchestration.taskCreate', {
    spec: args.spec,
    taskTitle: node.title,
    deps: JSON.stringify([...new Set(deps)]),
    workflowNodeId: node.id,
    workflowIteration: args.iteration
  })
  const taskId = taskIdFromResult(result)
  if (!taskId) {
    throw new Error(`orchestration.taskCreate returned no task id for node ${node.id}.`)
  }
  return taskId
}
