import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fanOutWorkflow,
  joinDriver,
  joinNode,
  joinWorkflow
} from './workflow-run-controller-join-fixtures'
import { createControllerHarness, waitUntil } from './workflow-run-controller-test-harness'

describe('WorkflowRunController Join execution', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof joinDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-controller-join-'))
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

  const joinAttempts = (runId: string) =>
    h.db.listWorkflowAttempts(runId).filter((attempt) => attempt.nodeId === 'join')

  it('starts every branch at once and holds a wait-all Join in Waiting until the last completes', async () => {
    const run = h.createRun(fanOutWorkflow('all', 'fail'))
    const finished = h.createController(run.id).run()
    await waitUntil(() => ['a', 'b', 'c'].every((id) => d.attempt(run.id, id)?.state === 'running'))
    expect(h.workerHandles).toHaveLength(3)
    expect(d.attempt(run.id, 'join')).toBeUndefined()

    await d.report(run.id, 'a', 'succeeded')
    await d.reached(run.id, 'join', ['waiting'])
    await d.report(run.id, 'b', 'succeeded')
    await d.reached(run.id, 'b', ['completed'])
    expect(d.attempt(run.id, 'join')).toMatchObject({
      state: 'waiting',
      resultJson: { branches: { a: 'completed', b: 'completed', c: 'pending' } }
    })

    await d.report(run.id, 'c', 'succeeded')
    const integrate = await d.report(run.id, 'integrate', 'succeeded')
    await expect(finished).resolves.toBe('completed')

    const branches = { a: 'completed', b: 'completed', c: 'completed' }
    expect(joinAttempts(run.id)).toHaveLength(1)
    expect(d.attempt(run.id, 'join')).toMatchObject({
      state: 'completed',
      resultJson: { branches }
    })
    const brief = await readFile(join(workspaceRoot, integrate.briefPath ?? ''), 'utf-8')
    expect(brief).toContain(`Branches: ${JSON.stringify(branches)}`)
  })

  it('rehydrates a Waiting Join without creating a second attempt', async () => {
    const run = h.createRun(fanOutWorkflow('all', 'fail'))
    const first = h.createController(run.id)
    const firstFinished = first.run()
    await d.report(run.id, 'a', 'succeeded')
    await d.report(run.id, 'b', 'succeeded')
    await d.reached(run.id, 'b', ['completed'])
    await d.reached(run.id, 'join', ['waiting'])
    first.stop()
    await expect(firstFinished).resolves.toBe('running')

    await d.report(run.id, 'c', 'succeeded')
    const second = h.createController(run.id)
    const secondFinished = second.run()
    await d.report(run.id, 'integrate', 'succeeded')
    await expect(secondFinished).resolves.toBe('completed')
    expect(joinAttempts(run.id)).toEqual([
      expect.objectContaining({
        state: 'completed',
        resultJson: { branches: { a: 'completed', b: 'completed', c: 'completed' } }
      })
    ])
  })

  it('continues a partial Join once the others complete, exposing each branch outcome', async () => {
    const run = h.createRun(fanOutWorkflow('all', 'partial'))
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'b', 'failed')
    await d.report(run.id, 'a', 'succeeded')
    await d.reached(run.id, 'a', ['completed'])
    expect(d.attempt(run.id, 'join')?.state).toBe('waiting')
    await d.report(run.id, 'c', 'succeeded')
    const integrate = await d.report(run.id, 'integrate', 'succeeded')
    await expect(finished).resolves.toBe('completed')

    const inputs = JSON.parse(
      await readFile(
        join(workspaceRoot, dirname(integrate.briefPath ?? ''), 'inputs.json'),
        'utf-8'
      )
    )
    expect(inputs.joinBranches).toEqual({ a: 'completed', b: 'failed', c: 'completed' })
  })

  it('lets a wait-any Join proceed on the first completed branch', async () => {
    const run = h.createRun(fanOutWorkflow('any', 'partial'))
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'b', 'succeeded')
    await d.reached(run.id, 'join', ['completed'])
    expect(d.attempt(run.id, 'join')).toMatchObject({
      resultJson: { branches: { a: 'pending', b: 'completed', c: 'pending' } }
    })
    await d.report(run.id, 'integrate', 'succeeded')
    await d.report(run.id, 'a', 'succeeded')
    await d.report(run.id, 'c', 'succeeded')
    await expect(finished).resolves.toBe('completed')
  })

  it('cancels a Join left Waiting on a branch nothing can settle, then fails the run', async () => {
    // The Approval seam (not yet run by the engine) stands in for a branch that never settles.
    const workflow = joinWorkflow(
      ['a'],
      [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'start', to: 'gate' },
        { id: 'e3', from: 'a', to: 'join' },
        { id: 'e4', from: 'gate', to: 'join', fromPort: 'yes' }
      ],
      joinNode('all', 'fail')
    )
    workflow.nodes.push({
      id: 'gate',
      type: 'approval',
      title: 'Gate',
      question: 'ok?',
      options: ['yes'],
      timeoutMs: 1000,
      escalationGraceMs: 1000
    })
    const run = h.createRun(workflow)
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'a', 'succeeded')
    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'join')?.state).toBe('cancelled')
  })
})
