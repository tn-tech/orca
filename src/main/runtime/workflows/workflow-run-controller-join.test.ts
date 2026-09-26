import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JoinNode, Node, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

function branchAgent(id: string, prompt = `Do ${id}.`): Node {
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
      properties: { summary: { type: 'string' } }
    },
    artifacts: [],
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
  }
}

// start -> a|b|c -> join -> integrate -> end
function fanOutWorkflow(policy: JoinNode['policy'], onFailure: JoinNode['onFailure']): Workflow {
  return {
    ...TWO_NODE_WORKFLOW,
    name: 'fan-out',
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      branchAgent('a'),
      branchAgent('b'),
      branchAgent('c'),
      { id: 'join', type: 'join', title: 'Join', policy, onFailure },
      branchAgent('integrate', 'Integrate. Branches: ${join.branches}'),
      { id: 'end', type: 'end', title: 'Done' }
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'a' },
      { id: 'e2', from: 'start', to: 'b' },
      { id: 'e3', from: 'start', to: 'c' },
      { id: 'e4', from: 'a', to: 'join' },
      { id: 'e5', from: 'b', to: 'join' },
      { id: 'e6', from: 'c', to: 'join' },
      { id: 'e7', from: 'join', to: 'integrate' },
      { id: 'e8', from: 'integrate', to: 'end' }
    ]
  }
}

describe('WorkflowRunController Join execution', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-controller-join-'))
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

  function attempt(runId: string, nodeId: string): NodeAttemptView | undefined {
    return h.db.listWorkflowAttempts(runId).find((candidate) => candidate.nodeId === nodeId)
  }

  async function report(runId: string, nodeId: string, outcome: 'succeeded' | 'failed') {
    await waitUntil(() => attempt(runId, nodeId)?.state === 'running')
    const found = attempt(runId, nodeId)
    const handle = found?.dispatchId
      ? h.db.getWorkerDispatch(found.dispatchId)?.agent_terminal_handle
      : undefined
    if (!found?.taskId || !found.dispatchId || !found.resultPath || !handle) {
      throw new Error(`${nodeId} is not dispatched`)
    }
    await h.writeResult(found.resultPath, { summary: `${nodeId} ${outcome}` })
    await h.sendWorkerDone({
      handle,
      taskId: found.taskId,
      dispatchId: found.dispatchId,
      reportPath: found.resultPath,
      outcome
    })
    return found
  }

  async function settled(runId: string, nodeId: string) {
    await waitUntil(() => {
      const state = attempt(runId, nodeId)?.state
      return state === 'completed' || state === 'failed'
    })
  }

  it('starts every branch at once and holds a wait-all Join until the last branch completes', async () => {
    const run = h.createRun(fanOutWorkflow('all', 'fail'))
    const finished = h.createController(run.id).run()
    await waitUntil(() => ['a', 'b', 'c'].every((id) => attempt(run.id, id)?.state === 'running'))
    expect(h.workerHandles).toHaveLength(3)

    await report(run.id, 'a', 'succeeded')
    await report(run.id, 'b', 'succeeded')
    await settled(run.id, 'b')
    expect(attempt(run.id, 'join')).toBeUndefined()

    await report(run.id, 'c', 'succeeded')
    const integrate = await report(run.id, 'integrate', 'succeeded')
    await expect(finished).resolves.toBe('completed')

    const branches = { a: 'completed', b: 'completed', c: 'completed' }
    expect(attempt(run.id, 'join')).toMatchObject({ state: 'completed', resultJson: { branches } })
    const brief = await readFile(join(workspaceRoot, integrate.briefPath ?? ''), 'utf-8')
    expect(brief).toContain(`Branches: ${JSON.stringify(branches)}`)
  })

  it('fails a fail-on-any Join on the first failure and stops the running siblings', async () => {
    const stops: unknown[] = []
    const dispatch = h.dispatcher.dispatchAsWorkflowEngine.bind(h.dispatcher)
    vi.spyOn(h.dispatcher, 'dispatchAsWorkflowEngine').mockImplementation(
      async (request, ...rest) => {
        if (request.method !== 'orchestration.workerStop') {
          return dispatch(request, ...rest)
        }
        const dispatchId: unknown = Reflect.get(Object(request.params), 'dispatch')
        stops.push(dispatchId)
        // The worker for `a` is proven stopped; the one for `c` cannot be confirmed.
        return {
          id: request.id,
          ok: true,
          result:
            dispatchId === attempt(run.id, 'a')?.dispatchId
              ? { dispatchId, state: 'stopped', alreadySettled: false }
              : { dispatchId, state: 'running', lastError: 'no terminal' },
          _meta: { runtimeId: 'test' }
        }
      }
    )
    const run = h.createRun(fanOutWorkflow('all', 'fail'))
    const finished = h.createController(run.id).run()
    await waitUntil(() => ['a', 'b', 'c'].every((id) => attempt(run.id, id)?.state === 'running'))

    await report(run.id, 'b', 'failed')
    await settled(run.id, 'join')
    expect(attempt(run.id, 'join')).toMatchObject({
      state: 'failed',
      failureReason: 'join_branch_failed',
      resultJson: { branches: { a: 'pending', b: 'failed', c: 'pending' } }
    })
    expect(stops.sort()).toEqual(
      [attempt(run.id, 'a')?.dispatchId, attempt(run.id, 'c')?.dispatchId].sort()
    )
    expect(attempt(run.id, 'a')?.state).toBe('cancelled')
    expect(attempt(run.id, 'c')?.state).toBe('running')
    const unconfirmed = h.db
      .listWorkflowEvents(run.id)
      .find((event) => event.kind === 'join_branch_stop_unconfirmed')
    expect(unconfirmed?.payloadJson).toMatchObject({
      joinNodeId: 'join',
      nodeId: 'c',
      state: 'running',
      lastError: 'no terminal'
    })
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('running')

    // The unconfirmed sibling still reports in; only then is the run quiet and failed.
    await report(run.id, 'c', 'succeeded')
    await expect(finished).resolves.toBe('failed')
    expect(attempt(run.id, 'integrate')?.state).toBe('skipped')
  })

  it('continues a partial Join once the others complete, exposing each branch outcome', async () => {
    const run = h.createRun(fanOutWorkflow('all', 'partial'))
    const finished = h.createController(run.id).run()
    await report(run.id, 'b', 'failed')
    await report(run.id, 'a', 'succeeded')
    await settled(run.id, 'a')
    expect(attempt(run.id, 'join')).toBeUndefined()
    await report(run.id, 'c', 'succeeded')
    const integrate = await report(run.id, 'integrate', 'succeeded')
    await expect(finished).resolves.toBe('completed')

    const branches = { a: 'completed', b: 'failed', c: 'completed' }
    const inputs = JSON.parse(
      await readFile(
        join(workspaceRoot, join(integrate.briefPath ?? '', '..'), 'inputs.json'),
        'utf-8'
      )
    )
    expect(inputs.joinBranches).toEqual(branches)
  })

  it('lets a wait-any Join proceed on the first completed branch', async () => {
    const run = h.createRun(fanOutWorkflow('any', 'partial'))
    const finished = h.createController(run.id).run()
    await report(run.id, 'b', 'succeeded')
    await settled(run.id, 'join')
    expect(attempt(run.id, 'join')).toMatchObject({
      state: 'completed',
      resultJson: { branches: { a: 'pending', b: 'completed', c: 'pending' } }
    })
    await report(run.id, 'integrate', 'succeeded')
    await report(run.id, 'a', 'succeeded')
    await report(run.id, 'c', 'succeeded')
    await expect(finished).resolves.toBe('completed')
  })
})
