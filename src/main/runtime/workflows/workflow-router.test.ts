import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LoopNode,
  RouterNode,
  Workflow
} from '../../../shared/workflows/workflow-definition-types'
import { buildBriefMarkdown } from './workflow-brief-builder'
import { computeFrontier } from './workflow-frontier'
import { agent, attempt, end, start, workflow } from './workflow-frontier-test-fixtures'
import { computeLoopProgress } from './workflow-loop-unrolling'
import { branchAgent, joinDriver } from './workflow-run-controller-join-fixtures'
import {
  createControllerHarness,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

const router: RouterNode = {
  id: 'route',
  type: 'router',
  title: 'Route',
  roleId: 'developer',
  prompt: 'Is ${objective} a bugfix or a feature?',
  choices: ['bugfix', 'feature']
}

// start -> route -[bugfix]-> bugfix -> end; route -[feature]-> feature -> end
const routerWorkflow: Workflow = {
  ...TWO_NODE_WORKFLOW,
  name: 'router',
  nodes: [start, router, branchAgent('bugfix'), branchAgent('feature'), end],
  edges: [
    { id: 'e-route', from: 'start', to: 'route' },
    { id: 'e-bugfix', from: 'route', to: 'bugfix', fromPort: 'bugfix' },
    { id: 'e-feature', from: 'route', to: 'feature', fromPort: 'feature' },
    { id: 'e-bugfix-end', from: 'bugfix', to: 'end' },
    { id: 'e-feature-end', from: 'feature', to: 'end' }
  ]
}

describe('Router routing (pure)', () => {
  it('fires only the chosen port edge and skips the other branch downstream', () => {
    const def = workflow(
      [start, router, agent('bugfix'), agent('feature'), agent('ship'), end],
      [
        { id: 'e1', from: 'start', to: 'route' },
        { id: 'e2', from: 'route', to: 'bugfix', fromPort: 'bugfix' },
        { id: 'e3', from: 'route', to: 'feature', fromPort: 'feature' },
        { id: 'e4', from: 'feature', to: 'ship' },
        { id: 'e5', from: 'bugfix', to: 'end' },
        { id: 'e6', from: 'ship', to: 'end' }
      ]
    )
    const routed = [
      attempt('start', 'completed'),
      attempt('route', 'completed', { resultJson: { choice: 'bugfix', reason: 'a crash' } })
    ]
    expect(computeFrontier(def, routed)).toEqual({
      eligible: ['bugfix'],
      skipped: ['feature', 'ship']
    })
    expect(
      computeFrontier(def, [attempt('start', 'completed'), attempt('route', 'running')])
    ).toEqual({ eligible: [], skipped: [] })
  })

  it('fires no edge from a failed Router', () => {
    const def = workflow(routerWorkflow.nodes, routerWorkflow.edges)
    const failed = [
      attempt('start', 'completed'),
      attempt('route', 'failed', { resultJson: { choice: 'chore', reason: 'tidy' } })
    ]
    expect(computeFrontier(def, failed)).toEqual({
      eligible: [],
      skipped: ['bugfix', 'feature', 'end']
    })
  })

  it('runs a Router inside a Loop body and routes within the iteration', () => {
    const loop: LoopNode = {
      id: 'qa',
      type: 'loop',
      title: 'QA',
      body: { nodeIds: ['route', 'fix', 'polish'] },
      entryNodeId: 'route',
      exitNodeId: 'fix',
      maxIterations: 2,
      exitCondition: { path: 'summary', op: 'truthy' },
      onCapReached: 'fail'
    }
    const def = workflow(
      [start, loop, router, agent('fix'), agent('polish'), end],
      [
        { id: 'in', from: 'start', to: 'qa' },
        { id: 'b', from: 'route', to: 'fix', fromPort: 'bugfix' },
        { id: 'f', from: 'route', to: 'polish', fromPort: 'feature' },
        { id: 'out', from: 'qa', to: 'end', fromPort: 'exit' }
      ]
    )
    const withId = (a: ReturnType<typeof attempt>) => ({ ...a, id: `${a.nodeId}#0` })
    const running = [attempt('start', 'completed'), attempt('qa', 'running')].map(withId)
    expect(computeLoopProgress(def, running).eligible).toEqual([{ nodeId: 'route', iteration: 0 }])
    const routed = [
      ...running,
      withId(attempt('route', 'completed', { resultJson: { choice: 'bugfix', reason: 'bug' } }))
    ]
    const progress = computeLoopProgress(def, routed)
    expect(progress.eligible).toEqual([{ nodeId: 'fix', iteration: 0 }])
    expect(progress.skipped).toEqual([{ nodeId: 'polish', iteration: 0 }])
  })

  it('lists the allowed choices verbatim in the Router brief', () => {
    const { text } = buildBriefMarkdown({
      workflowName: 'wf',
      runId: 'run-1',
      attemptId: 'attempt-1',
      node: { ...router, choices: ['bug fix', 'feature `x`'] },
      systemPrompt: 'Decide.',
      skills: [],
      briefInputs: { objective: 'o', upstream: {} }
    })
    expect(text).toContain('- "bug fix"\n- "feature `x`"')
  })
})

describe('WorkflowRunController Router execution', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof joinDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-router-'))
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

  const events = (runId: string, kind: string) =>
    h.db.listWorkflowEvents(runId).filter((event) => event.kind === kind)

  it('fires only the chosen edge, skips the other branch, and records the reason', async () => {
    const run = h.createRun(routerWorkflow)
    const finished = h.createController(run.id).run()
    const routed = await d.report(run.id, 'route', 'succeeded', {
      choice: 'feature',
      reason: 'It adds a greeting.'
    })
    const brief = await readFile(join(workspaceRoot, routed.briefPath ?? ''), 'utf-8')
    expect(brief).toContain('- "bugfix"\n- "feature"')

    await d.reached(run.id, 'feature', ['running'])
    expect(d.attempt(run.id, 'bugfix')?.state).toBe('skipped')
    expect(d.attempt(run.id, 'route')).toMatchObject({
      state: 'completed',
      resultJson: { choice: 'feature', reason: 'It adds a greeting.' }
    })
    const [choiceEvent] = events(run.id, 'router_choice')
    expect(choiceEvent).toMatchObject({
      attemptId: routed.id,
      payloadJson: {
        nodeId: 'route',
        iteration: 0,
        choice: 'feature',
        reason: 'It adds a greeting.'
      }
    })

    // The skipped branch counts as satisfied where the two branches merge again.
    await d.report(run.id, 'feature', 'succeeded')
    await expect(finished).resolves.toBe('completed')
    expect(d.attempt(run.id, 'end')?.state).toBe('completed')
  })

  it('fails with result_invalid on a choice outside its choices, keeps the result, and fires no edge', async () => {
    const run = h.createRun(routerWorkflow)
    const finished = h.createController(run.id).run()
    await d.report(run.id, 'route', 'succeeded', { choice: 'chore', reason: 'Just tidying.' })

    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'route')).toMatchObject({
      state: 'failed',
      failureReason: 'result_invalid',
      resultJson: { choice: 'chore', reason: 'Just tidying.' }
    })
    expect(d.attempt(run.id, 'bugfix')?.state).toBe('skipped')
    expect(d.attempt(run.id, 'feature')?.state).toBe('skipped')
    expect(h.workerHandles).toHaveLength(1)
    expect(events(run.id, 'router_choice')).toEqual([])
  })

  it('fails with result_invalid when the result lacks a reason', async () => {
    const run = h.createRun(routerWorkflow)
    const finished = h.createController(run.id).run()
    await waitUntil(() => d.attempt(run.id, 'route')?.state === 'running')
    await d.report(run.id, 'route', 'succeeded', { choice: 'feature' })

    await expect(finished).resolves.toBe('failed')
    expect(d.attempt(run.id, 'route')).toMatchObject({ failureReason: 'result_invalid' })
    expect(d.attempt(run.id, 'feature')?.state).toBe('skipped')
  })
})
