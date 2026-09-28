import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import {
  incomingEdgeOutcome,
  latestAttemptByNode,
  loopExitSourceId,
  nodeTypeOf,
  type FrontierAttempt
} from './workflow-frontier'
import type { WorkflowOrchestrationClient } from './workflow-orchestration-client'

export type WorkflowTaskPort = Pick<WorkflowOrchestrationClient, 'call'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function taskIdFromResult(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined
  }
  const task = result.task
  if (!isRecord(task)) {
    return undefined
  }
  const id = task.id
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
    /** Pins the create's durable receipt, so a replay returns the Task already created. */
    requestId?: string
  }
): Promise<string> {
  const node = args.definition.nodes.find((candidate) => candidate.id === args.nodeId)
  if (!node) {
    throw new Error(`Workflow node ${args.nodeId} is not in the run's definition.`)
  }
  const latest = latestAttemptByNode(args.attempts)
  // Why: taskCreate leaves a Task pending while any dep is not completed, and only ready Tasks dispatch.
  const deps = args.definition.edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => ({ edge, sourceId: loopExitSourceId(args.definition.nodes, edge) }))
    .map(({ edge, sourceId }) => ({
      edge,
      source: latest.get(sourceId),
      sourceType: nodeTypeOf(args.definition.nodes, sourceId)
    }))
    .filter(
      ({ edge, source, sourceType }) =>
        incomingEdgeOutcome(edge, source, false, sourceType) === 'fired'
    )
    .map(({ source }) => source?.taskId)
    .filter((taskId): taskId is string => taskId !== undefined)
  const params = {
    spec: args.spec,
    taskTitle: node.title,
    deps: JSON.stringify([...new Set(deps)]),
    workflowNodeId: node.id,
    workflowIteration: args.iteration
  }
  const result = args.requestId
    ? await port.call('orchestration.taskCreate', params, { requestId: args.requestId })
    : await port.call('orchestration.taskCreate', params)
  const taskId = taskIdFromResult(result)
  if (!taskId) {
    throw new Error(`orchestration.taskCreate returned no task id for node ${node.id}.`)
  }
  return taskId
}
