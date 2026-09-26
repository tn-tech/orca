import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { Node, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

function loopAgent(
  id: string,
  roleId: string,
  prompt: string,
  properties: Record<string, JsonValue>
): Node {
  return {
    id,
    type: 'agent',
    title: id,
    roleId,
    prompt,
    workspace: 'run',
    resultContract: { type: 'object', required: Object.keys(properties), properties },
    artifacts: [],
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
  }
}

const LOOP_WORKFLOW: Workflow = {
  ...TWO_NODE_WORKFLOW,
  name: 'qa-loop',
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    {
      id: 'qa',
      type: 'loop',
      title: 'QA loop',
      body: { nodeIds: ['implement', 'review'] },
      entryNodeId: 'implement',
      exitNodeId: 'review',
      maxIterations: 3,
      exitCondition: { path: 'approved', op: 'eq', value: true },
      onCapReached: 'fail'
    },
    loopAgent(
      'implement',
      'developer',
      'Implement. Previous findings: ${loop.previous.review.result.findings}',
      { summary: { type: 'string' } }
    ),
    loopAgent('review', 'reviewer', 'Review ${objective}.', {
      approved: { type: 'boolean' },
      findings: { type: 'array', items: { type: 'string' } }
    }),
    { id: 'end', type: 'end', title: 'Done' }
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'qa' },
    { id: 'e2', from: 'implement', to: 'review' },
    { id: 'e3', from: 'review', to: 'implement', fromPort: 'body' },
    { id: 'e4', from: 'qa', to: 'end', fromPort: 'exit' }
  ]
}

describe('WorkflowRunController Loop execution', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-controller-loop-'))
    h = createControllerHarness(workspaceRoot)
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

  function attemptAt(
    runId: string,
    nodeId: string,
    iteration: number
  ): NodeAttemptView | undefined {
    return h.db
      .listWorkflowAttempts(runId)
      .find((candidate) => candidate.nodeId === nodeId && candidate.iteration === iteration)
  }

  async function completeAt(runId: string, nodeId: string, iteration: number, result: unknown) {
    await waitUntil(() => attemptAt(runId, nodeId, iteration)?.state === 'running')
    const found = attemptAt(runId, nodeId, iteration)
    if (!found?.taskId || !found.dispatchId || !found.resultPath) {
      throw new Error(`${nodeId}@${iteration} is not dispatched`)
    }
    const handle = h.workerHandles.at(-1) ?? ''
    await h.writeResult(found.resultPath, result)
    await h.sendWorkerDone({
      handle,
      taskId: found.taskId,
      dispatchId: found.dispatchId,
      reportPath: found.resultPath
    })
    return found
  }

  const rejected = (n: number) => ({ approved: false, findings: [`issue ${n}`] })

  it('iterates until the exit condition holds, feeding loop.previous to the next iteration', async () => {
    const run = h.createRun(LOOP_WORKFLOW)
    const finished = h.createController(run.id).run()

    for (let iteration = 0; iteration < 2; iteration += 1) {
      await completeAt(run.id, 'implement', iteration, { summary: `pass ${iteration}` })
      await completeAt(run.id, 'review', iteration, rejected(iteration))
    }
    const third = await completeAt(run.id, 'implement', 2, { summary: 'pass 2' })
    await completeAt(run.id, 'review', 2, { approved: true, findings: [] })
    await expect(finished).resolves.toBe('completed')

    const inputs = JSON.parse(
      await readFile(join(workspaceRoot, dirname(third.resultPath ?? ''), 'inputs.json'), 'utf-8')
    )
    expect(inputs).toMatchObject({
      nodeId: 'implement',
      iteration: 2,
      loopPrevious: {
        review: { result: rejected(1) },
        implement: { result: { summary: 'pass 1' } }
      }
    })
    const brief = await readFile(join(workspaceRoot, third.briefPath ?? ''), 'utf-8')
    expect(brief).toContain('Previous findings: ["issue 1"]')
    expect(brief).toContain('Loop iteration 2 (0-based)')
    expect(brief).toContain('| review | `{"approved":false,"findings":["issue 1"]}` | — |')

    const tasks = h.db.listTasks({ runId: h.db.getRunForWorkflowRun(run.id)?.id })
    expect(tasks.map((task) => [task.workflow_node_id, task.workflow_iteration]).sort()).toEqual([
      ['implement', 0],
      ['implement', 1],
      ['implement', 2],
      ['review', 0],
      ['review', 1],
      ['review', 2]
    ])
    expect(attemptAt(run.id, 'qa', 0)).toMatchObject({
      state: 'completed',
      resultJson: { iterations: 3, exitResult: { approved: true, findings: [] } }
    })
    expect(attemptAt(run.id, 'end', 0)?.state).toBe('completed')
    const started = h.db
      .listWorkflowEvents(run.id)
      .filter((event) => event.kind === 'loop_iteration_started')
      .map((event) => event.payloadJson)
    expect(started).toEqual([
      { loopId: 'qa', iteration: 0 },
      { loopId: 'qa', iteration: 1 },
      { loopId: 'qa', iteration: 2 }
    ])
  })

  it('fails the loop and the run with loop_cap_reached, keeping the last findings', async () => {
    const run = h.createRun(LOOP_WORKFLOW)
    const finished = h.createController(run.id).run()

    for (let iteration = 0; iteration < 3; iteration += 1) {
      await completeAt(run.id, 'implement', iteration, { summary: `pass ${iteration}` })
      await completeAt(run.id, 'review', iteration, rejected(iteration))
    }
    await expect(finished).resolves.toBe('failed')

    expect(attemptAt(run.id, 'qa', 0)).toMatchObject({
      state: 'failed',
      failureReason: 'loop_cap_reached',
      resultJson: { iterations: 3, exitResult: rejected(2) }
    })
    expect(attemptAt(run.id, 'implement', 3)).toBeUndefined()
    expect(attemptAt(run.id, 'end', 0)?.state).toBe('skipped')
    const runFailed = h.db.listWorkflowEvents(run.id).find((event) => event.kind === 'run_failed')
    expect(runFailed?.payloadJson).toMatchObject({ reason: 'node_failed', failedNodes: ['qa'] })
  })

  it('rehydrates mid-iteration without re-running finished nodes of that iteration', async () => {
    const run = h.createRun(LOOP_WORKFLOW)
    const first = h.createController(run.id)
    const firstFinished = first.run()
    for (let iteration = 0; iteration < 2; iteration += 1) {
      await completeAt(run.id, 'implement', iteration, { summary: `pass ${iteration}` })
      await completeAt(run.id, 'review', iteration, rejected(iteration))
    }
    await completeAt(run.id, 'implement', 2, { summary: 'pass 2' })
    await waitUntil(() => attemptAt(run.id, 'review', 2)?.state === 'running')
    first.stop()
    await expect(firstFinished).resolves.toBe('running')
    const workersBefore = h.workerHandles.length

    const second = h.createController(run.id)
    const secondFinished = second.run()
    await completeAt(run.id, 'review', 2, { approved: true, findings: [] })
    await expect(secondFinished).resolves.toBe('completed')

    expect(h.workerHandles).toHaveLength(workersBefore)
    const bodyAttempts = h.db
      .listWorkflowAttempts(run.id)
      .filter((a) => a.nodeId === 'implement' || a.nodeId === 'review')
      .map((a) => `${a.nodeId}@${a.iteration}`)
    expect(bodyAttempts.sort()).toEqual([
      'implement@0',
      'implement@1',
      'implement@2',
      'review@0',
      'review@1',
      'review@2'
    ])
    expect(attemptAt(run.id, 'qa', 0)).toMatchObject({ state: 'completed' })
  })
})
