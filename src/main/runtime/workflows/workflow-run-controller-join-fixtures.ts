// Join workflows and a worker driver shared by the controller Join tests.
import { vi } from 'vitest'
import type {
  Edge,
  JoinNode,
  Node,
  Workflow
} from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { readPath } from './workflow-follow-up-interrupt'
import {
  type createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

type Harness = ReturnType<typeof createControllerHarness>

export function branchAgent(id: string, prompt = `Do ${id}.`): Node {
  return {
    id,
    type: 'agent',
    title: id,
    roleId: 'developer',
    prompt,
    workspace: 'run',
    resultContract: {
      type: 'object',
      required: ['summary'],
      properties: { summary: { type: 'string' }, go: { type: 'boolean' } }
    },
    artifacts: [],
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
  }
}

export function joinNode(policy: JoinNode['policy'], onFailure: JoinNode['onFailure']): JoinNode {
  return { id: 'join', type: 'join', title: 'Join', policy, onFailure }
}

/** start -> <branch agents, wired by `edges`> -> join -> integrate -> end */
export function joinWorkflow(branchIds: string[], edges: Edge[], join: JoinNode): Workflow {
  return {
    ...TWO_NODE_WORKFLOW,
    name: 'fan-out',
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      ...branchIds.map((id) => branchAgent(id)),
      join,
      branchAgent('integrate', 'Integrate. Branches: ${join.branches}'),
      { id: 'end', type: 'end', title: 'Done' }
    ],
    edges: [
      ...edges,
      { id: 'to-integrate', from: 'join', to: 'integrate' },
      { id: 'to-end', from: 'integrate', to: 'end' }
    ]
  }
}

/** start -> a|b|c -> join -> integrate -> end */
export function fanOutWorkflow(
  policy: JoinNode['policy'],
  onFailure: JoinNode['onFailure']
): Workflow {
  const ids = ['a', 'b', 'c']
  return joinWorkflow(
    ids,
    ids.flatMap((id) => [
      { id: `start-${id}`, from: 'start', to: id },
      { id: `${id}-join`, from: id, to: 'join' }
    ]),
    joinNode(policy, onFailure)
  )
}

export function joinDriver(h: Harness) {
  function attempt(runId: string, nodeId: string): NodeAttemptView | undefined {
    return h.db.listWorkflowAttempts(runId).find((candidate) => candidate.nodeId === nodeId)
  }

  async function report(
    runId: string,
    nodeId: string,
    outcome: 'succeeded' | 'failed',
    result: Record<string, unknown> = {}
  ) {
    await waitUntil(() => attempt(runId, nodeId)?.state === 'running')
    const found = attempt(runId, nodeId)
    const handle = found?.dispatchId
      ? h.db.getWorkerDispatch(found.dispatchId)?.agent_terminal_handle
      : undefined
    if (!found?.taskId || !found.dispatchId || !found.resultPath || !handle) {
      throw new Error(`${nodeId} is not dispatched`)
    }
    await h.writeResult(found.resultPath, { summary: `${nodeId} ${outcome}`, ...result })
    await h.sendWorkerDone({
      handle,
      taskId: found.taskId,
      dispatchId: found.dispatchId,
      reportPath: found.resultPath,
      outcome
    })
    return found
  }

  async function reached(runId: string, nodeId: string, states: NodeAttemptView['state'][]) {
    await waitUntil(() => states.some((state) => attempt(runId, nodeId)?.state === state))
  }

  /** Answers the engine's workerStop calls with `receiptFor`; every other call goes through. */
  function interceptWorkerStop(receiptFor: (dispatchId: unknown) => Record<string, unknown>) {
    const stops: unknown[] = []
    const dispatch = h.dispatcher.dispatchAsWorkflowEngine.bind(h.dispatcher)
    vi.spyOn(h.dispatcher, 'dispatchAsWorkflowEngine').mockImplementation(
      async (request, ...rest) => {
        if (request.method !== 'orchestration.workerStop') {
          return dispatch(request, ...rest)
        }
        const dispatchId: unknown = readPath(request.params, ['dispatch'])
        stops.push(dispatchId)
        return {
          id: request.id,
          ok: true,
          result: { dispatchId, ...receiptFor(dispatchId) },
          _meta: { runtimeId: 'test' }
        }
      }
    )
    return stops
  }

  return { attempt, report, reached, interceptWorkerStop }
}
