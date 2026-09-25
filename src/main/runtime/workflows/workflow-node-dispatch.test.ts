import { describe, expect, it, vi } from 'vitest'
import type { AgentNode, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { engineCoordinatorHandle } from './workflow-engine-principal'
import { dispatchWorkflowNode, resolveNodeLaunch } from './workflow-node-dispatch'

const baseNode: AgentNode = {
  id: 'implement',
  type: 'agent',
  title: 'Implement',
  prompt: 'do it',
  workspace: 'run',
  resultContract: { type: 'object' },
  artifacts: [],
  question: { timeoutMs: 1000, escalationGraceMs: 1000 }
}

const roles: Workflow['roles'] = {
  implementer: {
    id: 'implementer',
    name: 'Implementer',
    agent: 'claude',
    model: 'sonnet',
    effort: 'high',
    systemPrompt: 'Implement exactly what the objective describes.',
    skills: []
  },
  scribe: {
    id: 'scribe',
    name: 'Scribe',
    agent: 'omp', // no model catalog support (catalogSupportsWorkerLaunchPreferences(omp) === false)
    model: 'omp-fast', // set deliberately so the gate has something real to strip
    effort: 'thorough',
    systemPrompt: 'Write things down.',
    skills: []
  }
}

function attemptView(state: NodeAttemptView['state']): NodeAttemptView {
  return {
    id: 'wfa_1',
    runId: 'wfr_1',
    nodeId: 'implement',
    nodeType: 'agent',
    iteration: 0,
    attemptIndex: 0,
    state,
    artifactsJson: []
  }
}

function createAttemptStore() {
  return {
    transitionWorkflowAttempt: vi.fn((_id: string, to: NodeAttemptView['state']) =>
      attemptView(to)
    ),
    updateWorkflowAttempt: vi.fn((_id: string, _patch: unknown) => attemptView('provisioning'))
  }
}

const READY_RESULT = {
  dispatchId: 'wdp_1',
  state: 'ready',
  launch: {
    requested: { agent: 'claude', model: 'sonnet', effort: 'high' },
    effective: { agent: 'claude', model: 'sonnet', effort: 'high' }
  }
}

describe('resolveNodeLaunch', () => {
  it('takes agent/model/effort/systemPrompt from the role when no overrides are set', () => {
    expect(resolveNodeLaunch({ ...baseNode, roleId: 'implementer' }, roles)).toEqual({
      agent: 'claude',
      model: 'sonnet',
      effort: 'high',
      systemPrompt: 'Implement exactly what the objective describes.'
    })
  })

  it('lets node overrides win field-by-field over the role (FR-017)', () => {
    const resolved = resolveNodeLaunch(
      {
        ...baseNode,
        roleId: 'implementer',
        overrides: { model: 'haiku', systemPrompt: 'Be terse.' }
      },
      roles
    )
    expect(resolved).toEqual({
      agent: 'claude', // unmodified fields still come from the role
      model: 'haiku', // overridden
      effort: 'high', // unmodified
      systemPrompt: 'Be terse.' // overridden
    })
  })

  it('resolves purely from overrides when the node has no roleId', () => {
    const resolved = resolveNodeLaunch(
      { ...baseNode, overrides: { agent: 'codex', systemPrompt: 'Go.' } },
      roles
    )
    expect(resolved).toEqual({ agent: 'codex', systemPrompt: 'Go.' })
  })

  it('throws when neither the role nor overrides set an agent', () => {
    expect(() => resolveNodeLaunch(baseNode, roles)).toThrow(/has no agent/)
  })
})

describe('dispatchWorkflowNode', () => {
  it('dispatches through provisioning to running and records requested/effective launch', async () => {
    const attemptStore = createAttemptStore()
    const call = vi.fn(async () => READY_RESULT)

    const outcome = await dispatchWorkflowNode({
      port: { call },
      attemptStore,
      runId: 'wfr_1',
      attemptId: 'wfa_1',
      taskId: 'task_1',
      node: { ...baseNode, roleId: 'implementer' },
      roles
    })

    expect(outcome.ok).toBe(true)
    expect(call).toHaveBeenCalledWith('orchestration.workerStart', {
      from: engineCoordinatorHandle('wfr_1'),
      task: 'task_1',
      agent: 'claude',
      model: 'sonnet',
      effort: 'high'
    })
    expect(attemptStore.transitionWorkflowAttempt).toHaveBeenNthCalledWith(
      1,
      'wfa_1',
      'provisioning'
    )
    expect(attemptStore.transitionWorkflowAttempt).toHaveBeenNthCalledWith(2, 'wfa_1', 'running')
    expect(attemptStore.updateWorkflowAttempt).toHaveBeenCalledWith('wfa_1', {
      dispatchId: 'wdp_1',
      requestedLaunch: { agent: 'claude', model: 'sonnet', effort: 'high' },
      effectiveLaunch: { agent: 'claude', model: 'sonnet', effort: 'high' }
    })
    // provisioning must be entered before worker-start is called (data-model.md §4).
    expect(attemptStore.transitionWorkflowAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      call.mock.invocationCallOrder[0]
    )
    // running is only recorded once the receipt is in hand.
    expect(call.mock.invocationCallOrder[0]).toBeLessThan(
      attemptStore.transitionWorkflowAttempt.mock.invocationCallOrder[1]
    )
  })

  it('omits requested model/effort for an agent without model support (US1 AS5)', async () => {
    // The `scribe` role sets model/effort even though `omp` has no catalog support for them
    // (resolveNodeLaunch itself has no opinion on support — it just merges fields). Dispatch must
    // still strip both before calling workerStart: this is what actually exercises the gate at
    // workflow-node-dispatch.ts (catalogSupportsWorkerLaunchPreferences check before the params
    // object is built). Confirmed this test fails with that gate removed — see U18-report.md.
    expect(resolveNodeLaunch({ ...baseNode, roleId: 'scribe' }, roles)).toEqual({
      agent: 'omp',
      model: 'omp-fast',
      effort: 'thorough',
      systemPrompt: 'Write things down.'
    })

    const attemptStore = createAttemptStore()
    // The server only ever sees what we actually sent (no model/effort), so a real server's
    // receipt echoes that back as both the requested and effective launch.
    const call = vi.fn(async () => ({
      dispatchId: 'wdp_2',
      state: 'ready',
      launch: {
        requested: { agent: 'omp', model: null, effort: null },
        effective: { agent: 'omp', model: null, effort: null }
      }
    }))

    await dispatchWorkflowNode({
      port: { call },
      attemptStore,
      runId: 'wfr_1',
      attemptId: 'wfa_1',
      taskId: 'task_1',
      node: { ...baseNode, roleId: 'scribe' },
      roles
    })

    // Exact-object equality: this fails if `model`/`effort` leak into the call, since the role
    // sets both above and `toHaveBeenCalledWith` rejects any extra key on the actual params.
    expect(call).toHaveBeenCalledWith('orchestration.workerStart', {
      from: engineCoordinatorHandle('wfr_1'),
      task: 'task_1',
      agent: 'omp'
    })
    expect(attemptStore.updateWorkflowAttempt).toHaveBeenCalledWith('wfa_1', {
      dispatchId: 'wdp_2',
      requestedLaunch: { agent: 'omp' },
      effectiveLaunch: { agent: 'omp' }
    })
  })

  it('fails the attempt without calling workerStart when role resolution fails', async () => {
    const attemptStore = createAttemptStore()
    const call = vi.fn(async () => READY_RESULT)

    const outcome = await dispatchWorkflowNode({
      port: { call },
      attemptStore,
      runId: 'wfr_1',
      attemptId: 'wfa_1',
      taskId: 'task_1',
      node: baseNode, // no roleId, no overrides.agent
      roles
    })

    expect(outcome).toMatchObject({ ok: false, failureReason: expect.stringMatching(/no agent/) })
    expect(call).not.toHaveBeenCalled()
    expect(attemptStore.transitionWorkflowAttempt).toHaveBeenNthCalledWith(
      1,
      'wfa_1',
      'provisioning'
    )
    expect(attemptStore.transitionWorkflowAttempt).toHaveBeenNthCalledWith(2, 'wfa_1', 'failed')
    expect(attemptStore.updateWorkflowAttempt).toHaveBeenCalledWith('wfa_1', {
      failureReason: expect.stringMatching(/no agent/)
    })
  })

  it('fails the attempt when the workerStart call rejects, with no retry', async () => {
    const attemptStore = createAttemptStore()
    const call = vi.fn(async () => {
      throw new Error('consumer_fenced: not bound to this run')
    })

    const outcome = await dispatchWorkflowNode({
      port: { call },
      attemptStore,
      runId: 'wfr_1',
      attemptId: 'wfa_1',
      taskId: 'task_1',
      node: { ...baseNode, roleId: 'implementer' },
      roles
    })

    expect(outcome).toMatchObject({
      ok: false,
      failureReason: 'consumer_fenced: not bound to this run'
    })
    expect(call).toHaveBeenCalledTimes(1)
    expect(attemptStore.transitionWorkflowAttempt).toHaveBeenNthCalledWith(2, 'wfa_1', 'failed')
    expect(attemptStore.updateWorkflowAttempt).toHaveBeenCalledWith('wfa_1', {
      failureReason: 'consumer_fenced: not bound to this run'
    })
  })

  it('fails the attempt when the receipt reports a non-ready state', async () => {
    const attemptStore = createAttemptStore()
    const call = vi.fn(async () => ({
      dispatchId: 'wdp_3',
      state: 'outcome_unknown',
      lastError: 'Agent startup blocked: no readiness signal observed.',
      launch: {
        requested: { agent: 'claude', model: 'sonnet', effort: 'high' },
        effective: null
      }
    }))

    const outcome = await dispatchWorkflowNode({
      port: { call },
      attemptStore,
      runId: 'wfr_1',
      attemptId: 'wfa_1',
      taskId: 'task_1',
      node: { ...baseNode, roleId: 'implementer' },
      roles
    })

    expect(outcome).toMatchObject({
      ok: false,
      failureReason: 'Agent startup blocked: no readiness signal observed.'
    })
    expect(attemptStore.updateWorkflowAttempt).toHaveBeenCalledWith('wfa_1', {
      failureReason: 'Agent startup blocked: no readiness signal observed.',
      dispatchId: 'wdp_3'
    })
    expect(attemptStore.transitionWorkflowAttempt).toHaveBeenNthCalledWith(2, 'wfa_1', 'failed')
  })
})
