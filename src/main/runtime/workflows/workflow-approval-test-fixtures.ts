// Approval workflows and a per-iteration driver shared by the Approval controller tests.
import type {
  ApprovalNode,
  Edge,
  Workflow
} from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView, RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import { branchAgent } from './workflow-run-controller-join-fixtures'
import {
  type createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

type Harness = ReturnType<typeof createControllerHarness>

/** Long enough that waitUntil's fake-clock nudges never reach a deadline by accident. */
export const HOUR_MS = 3_600_000

export function approvalNode(extra: Partial<ApprovalNode> = {}): ApprovalNode {
  return {
    id: 'gate',
    type: 'approval',
    title: 'Approve the plan?',
    question: 'Approve the plan?',
    options: ['approve', 'reject'],
    timeoutMs: HOUR_MS,
    escalationGraceMs: HOUR_MS,
    ...extra
  }
}

/**
 * start -> gate -(approve)-> a -> end, gate -(reject)-> b -> end, plus start -> side -> end so a
 * branch keeps running while the approval waits. `withRejectEdge: false` drops gate -> b (an
 * unvalidated graph) and `withSideBranch: false` drops side.
 */
export function approvalWorkflow(
  gate: ApprovalNode = approvalNode(),
  options: { withRejectEdge?: boolean; withSideBranch?: boolean } = {}
): Workflow {
  const withReject = options.withRejectEdge !== false
  const withSide = options.withSideBranch !== false
  const edges: Edge[] = [
    { id: 'start-gate', from: 'start', to: 'gate' },
    { id: 'gate-a', from: 'gate', to: 'a', fromPort: 'approve' },
    { id: 'a-end', from: 'a', to: 'end' }
  ]
  if (withReject) {
    edges.push(
      { id: 'gate-b', from: 'gate', to: 'b', fromPort: 'reject' },
      { id: 'b-end', from: 'b', to: 'end' }
    )
  }
  if (withSide) {
    edges.push(
      { id: 'start-side', from: 'start', to: 'side' },
      { id: 'side-end', from: 'side', to: 'end' }
    )
  }
  return {
    ...TWO_NODE_WORKFLOW,
    name: 'approval',
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      gate,
      ...(withSide ? [branchAgent('side')] : []),
      branchAgent('a'),
      ...(withReject ? [branchAgent('b')] : []),
      { id: 'end', type: 'end', title: 'Done' }
    ],
    edges
  }
}

/** Loop body work -> check(approval) -(ok|redo)-> record; exits once record reports `go: true`. */
export function approvalLoopWorkflow(): Workflow {
  return {
    ...TWO_NODE_WORKFLOW,
    name: 'approval-loop',
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      {
        id: 'qa',
        type: 'loop',
        title: 'QA',
        body: { nodeIds: ['work', 'check', 'record'] },
        entryNodeId: 'work',
        exitNodeId: 'record',
        maxIterations: 3,
        exitCondition: { path: 'go', op: 'eq', value: true },
        onCapReached: 'fail'
      },
      branchAgent('work'),
      approvalNode({ id: 'check', options: ['ok', 'redo'] }),
      branchAgent('record'),
      { id: 'end', type: 'end', title: 'Done' }
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'qa' },
      { id: 'e2', from: 'work', to: 'check' },
      { id: 'e3', from: 'check', to: 'record', fromPort: 'ok' },
      { id: 'e4', from: 'check', to: 'record', fromPort: 'redo' },
      { id: 'e5', from: 'record', to: 'work', fromPort: 'body' },
      { id: 'e6', from: 'qa', to: 'end', fromPort: 'exit' }
    ]
  }
}

export function approvalDriver(h: Harness) {
  function attempt(runId: string, nodeId: string, iteration = 0): NodeAttemptView | undefined {
    return h.db
      .listWorkflowAttempts(runId)
      .findLast((candidate) => candidate.nodeId === nodeId && candidate.iteration === iteration)
  }

  function question(runId: string, nodeId = 'gate', iteration = 0): RunQuestionView | undefined {
    const attemptId = attempt(runId, nodeId, iteration)?.id
    return h.db.listWorkflowQuestions(runId).find((candidate) => candidate.attemptId === attemptId)
  }

  async function reached(
    runId: string,
    nodeId: string,
    state: NodeAttemptView['state'],
    iteration = 0
  ): Promise<NodeAttemptView> {
    await waitUntil(() => attempt(runId, nodeId, iteration)?.state === state)
    const found = attempt(runId, nodeId, iteration)
    if (!found) {
      throw new Error(`${nodeId}#${iteration} has no attempt`)
    }
    return found
  }

  async function report(
    runId: string,
    nodeId: string,
    result: Record<string, unknown> = {},
    iteration = 0
  ): Promise<void> {
    const found = await reached(runId, nodeId, 'running', iteration)
    const handle = found.dispatchId
      ? h.db.getWorkerDispatch(found.dispatchId)?.agent_terminal_handle
      : undefined
    if (!found.taskId || !found.dispatchId || !found.resultPath || !handle) {
      throw new Error(`${nodeId}#${iteration} is not dispatched`)
    }
    await h.writeResult(found.resultPath, { summary: `${nodeId} done`, ...result })
    await h.sendWorkerDone({
      handle,
      taskId: found.taskId,
      dispatchId: found.dispatchId,
      reportPath: found.resultPath
    })
  }

  function eventKinds(runId: string): string[] {
    return h.db.listWorkflowEvents(runId).map((event) => event.kind)
  }

  return { attempt, question, reached, report, eventKinds }
}
