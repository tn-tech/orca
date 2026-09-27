import type { Edge, Node, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../shared/workflows/workflow-node-states'
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { FrontierAttempt } from './workflow-frontier'

export function agent(id: string): Node {
  return {
    id,
    type: 'agent',
    title: `Agent ${id}`,
    prompt: 'do it',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1000, escalationGraceMs: 1000 }
  }
}

export function workflow(nodes: Node[], edges: Edge[]): Workflow {
  return {
    version: 1,
    name: 'wf',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes,
    edges,
    layout: {}
  }
}

export function attempt(
  nodeId: string,
  state: WorkflowAttemptState,
  extra: { resultJson?: JsonValue; taskId?: string; attemptIndex?: number } = {}
): FrontierAttempt {
  return { nodeId, iteration: 0, attemptIndex: extra.attemptIndex ?? 0, state, ...extra }
}

/**
 * A Loop nested in another Loop's body. The engine never runs one, so a branch through it never
 * settles — the stand-in for "a branch nothing can settle".
 */
export function nestedLoop(id: string): Node {
  return {
    id,
    type: 'loop',
    title: `Nested loop ${id}`,
    body: { nodeIds: [] },
    entryNodeId: id,
    exitNodeId: id,
    maxIterations: 1,
    exitCondition: { path: 'done', op: 'truthy' },
    onCapReached: 'fail'
  }
}

export const start: Node = { id: 'start', type: 'start', title: 'Start' }
export const end: Node = { id: 'end', type: 'end', title: 'End' }

// start -> a -> b -> end
export const linear = workflow(
  [start, agent('a'), agent('b'), end],
  [
    { id: 'e1', from: 'start', to: 'a' },
    { id: 'e2', from: 'a', to: 'b' },
    { id: 'e3', from: 'b', to: 'end' }
  ]
)
