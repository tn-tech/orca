import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { approvalNode } from './workflow-approval-test-fixtures'
import { branchAgent, joinDriver } from './workflow-run-controller-join-fixtures'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

/** start -> qa{ work } -> end, start -> side -> end, start -> gate -(approve)-> end */
const CAPPED: Workflow = {
  ...TWO_NODE_WORKFLOW,
  name: 'loop-cap-stop',
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    {
      id: 'qa',
      type: 'loop',
      title: 'QA',
      body: { nodeIds: ['work'] },
      entryNodeId: 'work',
      exitNodeId: 'work',
      maxIterations: 2,
      exitCondition: { path: 'go', op: 'eq', value: true },
      onCapReached: 'fail'
    },
    branchAgent('work'),
    branchAgent('side'),
    approvalNode(),
    { id: 'end', type: 'end', title: 'Done' }
  ],
  edges: [
    { id: 'in', from: 'start', to: 'qa' },
    { id: 'out', from: 'qa', to: 'end', fromPort: 'exit' },
    { id: 'start-side', from: 'start', to: 'side' },
    { id: 'side-end', from: 'side', to: 'end' },
    { id: 'start-gate', from: 'start', to: 'gate' },
    { id: 'gate-end', from: 'gate', to: 'end', fromPort: 'approve' }
  ]
}

describe('WorkflowRunController Loop cap stops the run (spec edge case: Loop reaches its cap)', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof joinDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-loop-cap-stop-'))
    h = createControllerHarness(workspaceRoot)
    d = joinDriver(h)
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    h.db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  function workAt(runId: string, iteration: number): NodeAttemptView | undefined {
    return h.db
      .listWorkflowAttempts(runId)
      .find((attempt) => attempt.nodeId === 'work' && attempt.iteration === iteration)
  }

  async function rejectWork(runId: string, iteration: number): Promise<void> {
    await waitUntil(() => workAt(runId, iteration)?.state === 'running')
    const found = workAt(runId, iteration)
    const handle = found?.dispatchId
      ? h.db.getWorkerDispatch(found.dispatchId)?.agent_terminal_handle
      : undefined
    if (!found?.taskId || !found.dispatchId || !found.resultPath || !handle) {
      throw new Error(`work@${iteration} is not dispatched`)
    }
    await h.writeResult(found.resultPath, { summary: `pass ${iteration}`, go: false })
    await h.sendWorkerDone({
      handle,
      taskId: found.taskId,
      dispatchId: found.dispatchId,
      reportPath: found.resultPath
    })
  }

  async function runToCap(receipt: Record<string, unknown>) {
    const stops = d.interceptWorkerStop(() => receipt)
    const run = h.createRun(CAPPED)
    const finished = h.createController(run.id).run()
    await d.reached(run.id, 'side', ['running'])
    await d.reached(run.id, 'gate', ['waiting'])
    await rejectWork(run.id, 0)
    await rejectWork(run.id, 1)
    await expect(finished).resolves.toBe('failed')
    return { run, stops }
  }

  it('fails the run at the cap, stops running siblings and closes open approvals', async () => {
    const { run, stops } = await runToCap({ state: 'stopped' })
    expect(d.attempt(run.id, 'qa')).toMatchObject({
      state: 'failed',
      failureReason: 'loop_cap_reached',
      resultJson: { iterations: 2, exitResult: { summary: 'pass 1', go: false } }
    })
    expect(workAt(run.id, 1)?.state).toBe('completed')
    expect(stops).toEqual([d.attempt(run.id, 'side')?.dispatchId])
    expect(d.attempt(run.id, 'side')?.state).toBe('cancelled')
    expect(d.attempt(run.id, 'gate')?.state).toBe('cancelled')
    expect(h.db.listOpenWorkflowQuestions(run.id)).toEqual([])
    expect(d.attempt(run.id, 'end')).toBeUndefined()
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('failed')
    const failed = h.db.listWorkflowEvents(run.id).find((event) => event.kind === 'run_failed')
    expect(failed?.payloadJson).toMatchObject({
      reason: 'node_failed',
      failedNodes: ['qa'],
      failureReason: 'loop_cap_reached'
    })
  })

  it('never reports a sibling whose stop is unconfirmed as exited', async () => {
    const { run } = await runToCap({ state: 'running', lastError: 'no terminal' })
    expect(d.attempt(run.id, 'side')?.state).toBe('running')
    expect(
      h.db.listWorkflowEvents(run.id).some((event) => event.kind === 'loop_cap_stop_unconfirmed')
    ).toBe(true)
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('failed')
  })
})
