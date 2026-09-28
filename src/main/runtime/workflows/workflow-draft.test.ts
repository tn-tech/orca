import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { RpcDispatcher } from '../rpc/dispatcher'
import { listWorkflows } from './workflow-file-store'
import { sweepDraftRunsAtBoot, tearDownDraftRun } from './workflow-draft-teardown'
import { confirmWorkerStops, holdNextWorkerTerminal } from './workflow-draft-test-fixtures'
import { TUI_AGENT_AUTO_PICK_ORDER } from '../../../shared/tui-agent-selection'
import { storeFor } from './workflow-placement-test-fixtures'
import { WorkflowEngine } from './workflow-engine'
import { draftWorkflow, type WorkflowDraftResult } from './workflow-draft'
import {
  DRAFT_DEADLINE_MS,
  DRAFT_PLANNER_NODE_ID,
  DRAFT_PLANNER_RUN_VERSION,
  DRAFT_PLANNER_WORKFLOW_NAME,
  isDraftPlannerRun,
  workflowDefinitionResultContract,
  resolveWorkflowPlannerAgent
} from './workflow-draft-planner'
import {
  createControllerHarness,
  RUN_WORKTREE_ID,
  waitUntil
} from './workflow-run-controller-test-harness'

const VALIDATION = {
  agentSupportsModel: () => true,
  isKnownAgent: (agent: string) => agent === 'claude' || agent === 'codex'
}

/** What the planner writes to result.json: a file-shaped definition (roles keyed, no `id`). */
function draftedDefinition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'greeting',
    workspacePolicy: 'run-workspace',
    roles: {
      dev: { name: 'Developer', agent: 'claude', systemPrompt: 'Implement it.', skills: [] }
    },
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      {
        id: 'implement',
        type: 'agent',
        title: 'Implement',
        roleId: 'dev',
        prompt: 'Implement ${objective}.',
        workspace: 'run',
        resultContract: { type: 'object' },
        artifacts: [],
        question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
      },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'implement' },
      { id: 'e2', from: 'implement', to: 'end' }
    ],
    layout: {},
    ...overrides
  }
}

type Tracked = {
  done: boolean
  value?: WorkflowDraftResult
  error?: unknown
}

function track(promise: Promise<WorkflowDraftResult>): Tracked {
  const tracked: Tracked = { done: false }
  promise.then(
    (value) => Object.assign(tracked, { done: true, value }),
    (error: unknown) => Object.assign(tracked, { done: true, error })
  )
  return tracked
}

describe('draftWorkflow', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let repo: Repo
  let engine: WorkflowEngine
  let removeManagedWorktree: ReturnType<typeof vi.fn>
  let createManagedWorktree: ReturnType<typeof vi.fn>
  let workerCalls: MockInstance<RpcDispatcher['dispatchAsWorkflowEngine']>

  /** `realStore`: placement resolves through the runtime's own selectors (in-place drafts). */
  function setUp(realStore: boolean): void {
    h = createControllerHarness(workspaceRoot, realStore ? { store: storeFor(repo) } : {})
    removeManagedWorktree = vi.fn(async () => ({}))
    createManagedWorktree = vi.fn(async () => ({
      worktree: { id: RUN_WORKTREE_ID, path: workspaceRoot, branch: 'wf-branch' }
    }))
    Object.assign(h.runtime, {
      createManagedWorktree,
      showManagedWorktree: vi.fn(async () => ({ id: RUN_WORKTREE_ID, path: workspaceRoot })),
      removeManagedWorktree
    })
    engine = new WorkflowEngine({
      db: h.db,
      runtime: h.runtime,
      dispatcher: h.dispatcher,
      getRepo: (repoId) => (repoId === repo.id ? repo : undefined)
    })
    workerCalls = vi.spyOn(h.dispatcher, 'dispatchAsWorkflowEngine')
  }

  beforeEach(async () => {
    workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'workflow-draft-')))
    repo = { id: 'repo', path: workspaceRoot, displayName: 'Repo', badgeColor: '#000', addedAt: 0 }
    setUp(false)
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  })

  afterEach(async () => {
    await engine.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
    h.db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  function startDraft(
    overrides: { plannerAgent?: string; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Tracked {
    return track(
      draftWorkflow(
        {
          engine,
          db: h.db,
          tearDown: (runId, reason) =>
            tearDownDraftRun(
              {
                db: h.db,
                runtime: h.runtime,
                dispatcher: h.dispatcher,
                whenControllerSettled: (id) => engine.whenControllerSettled(id)
              },
              runId,
              reason
            ),
          validation: VALIDATION,
          pollIntervalMs: 200,
          ...(overrides.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {})
        },
        {
          repo,
          objective: 'Add a greeting to the CLI',
          plannerAgent: overrides.plannerAgent ?? 'claude',
          startedByClient: 'user',
          ...(overrides.signal ? { signal: overrides.signal } : {})
        }
      )
    )
  }

  function plannerAttempt() {
    const [run] = h.db.listWorkflowRuns().runs
    return run
      ? h.db.listWorkflowAttempts(run.id).find((a) => a.nodeId === DRAFT_PLANNER_NODE_ID)
      : undefined
  }

  /** Plays the stub agent (config/scripts/workflow-stub-agent.mjs): write result.json, report done. */
  async function stubAgentReports(
    result: unknown,
    options: { outcome?: 'succeeded' | 'failed'; writeResult?: boolean } = {}
  ): Promise<void> {
    await waitUntil(() => plannerAttempt()?.state === 'running')
    const attempt = plannerAttempt()
    if (!attempt?.taskId || !attempt.dispatchId || !attempt.resultPath) {
      throw new Error('planner attempt was not dispatched')
    }
    if (options.writeResult !== false) {
      await h.writeResult(attempt.resultPath, result)
    }
    await h.sendWorkerDone({
      handle: 'term_worker_1',
      taskId: attempt.taskId,
      dispatchId: attempt.dispatchId,
      reportPath: attempt.resultPath,
      ...(options.outcome ? { outcome: options.outcome } : {})
    })
  }

  async function settled(tracked: Tracked): Promise<WorkflowDraftResult> {
    await waitUntil(() => tracked.done)
    if (tracked.error !== undefined) {
      throw tracked.error
    }
    if (!tracked.value) {
      throw new Error('draft settled without a value')
    }
    return tracked.value
  }

  it('returns the validated draft, flagged as a draft, without writing any workflow file', async () => {
    const tracked = startDraft()
    await stubAgentReports(draftedDefinition())
    const result = await settled(tracked)

    expect(result.draft).toBe(true)
    expect(result.problems).toEqual([])
    expect(result.definition).toMatchObject({
      name: 'greeting',
      roles: { dev: { id: 'dev', agent: 'claude' } }
    })
    expect(result.runId).toMatch(/^wfr_/)
    expect(await listWorkflows(repo)).toEqual([])
    expect(await readdir(join(workspaceRoot, '.orca'))).not.toContain('workflows')
  })

  it('runs one planner Agent node whose result contract is the workflow definition schema', async () => {
    const tracked = startDraft({ plannerAgent: 'codex' })
    await stubAgentReports(draftedDefinition())
    const result = await settled(tracked)

    const snapshot = h.db.getWorkflowRun(result.runId)?.workflowSnapshot
    const dispatchNodes = snapshot?.nodes.filter((node) => node.type === 'agent') ?? []
    expect(dispatchNodes).toHaveLength(1)
    const [planner] = dispatchNodes
    expect(planner?.id).toBe(DRAFT_PLANNER_NODE_ID)
    expect(planner?.type === 'agent' && planner.resultContract).toEqual(
      workflowDefinitionResultContract()
    )
    const roleId = planner?.type === 'agent' ? planner.roleId : undefined
    expect(roleId && snapshot?.roles[roleId]?.agent).toBe('codex')
    expect(h.db.getWorkflowRun(result.runId)?.objective).toBe('Add a greeting to the CLI')
  })

  it('attaches graph problems to a draft that parses but is not a runnable graph', async () => {
    const tracked = startDraft()
    await stubAgentReports(
      draftedDefinition({
        nodes: [
          { id: 'start', type: 'start', title: 'Start' },
          {
            id: 'implement',
            type: 'agent',
            title: 'Implement',
            roleId: 'ghost',
            prompt: 'Implement it.',
            workspace: 'run',
            resultContract: { type: 'object' },
            artifacts: [],
            question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
          }
        ],
        edges: [{ id: 'e1', from: 'start', to: 'implement' }]
      })
    )
    const result = await settled(tracked)

    expect(result.definition?.name).toBe('greeting')
    const codes = result.problems.map((problem) => problem.code)
    expect(codes).toEqual(expect.arrayContaining(['graph_missing_end', 'graph_unknown_role']))
  })

  it('flags a dispatch node with neither a role nor an agent override', async () => {
    const tracked = startDraft()
    const definition = draftedDefinition()
    const nodes = [
      { id: 'start', type: 'start', title: 'Start' },
      {
        id: 'implement',
        type: 'agent',
        title: 'Implement',
        prompt: 'Implement it.',
        workspace: 'run',
        resultContract: { type: 'object' },
        artifacts: [],
        question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
      },
      { id: 'end', type: 'end', title: 'End' }
    ]
    await stubAgentReports({ ...definition, nodes })
    const result = await settled(tracked)

    expect(result.problems).toContainEqual(
      expect.objectContaining({
        code: 'graph_node_unassigned',
        nodeId: 'implement',
        severity: 'error'
      })
    )
  })

  it('returns schema problems, not a crash, when the draft does not match the definition schema', async () => {
    const tracked = startDraft()
    await stubAgentReports(draftedDefinition({ nodes: 'not-a-list' }))
    const result = await settled(tracked)

    expect(result.definition).toBeUndefined()
    expect(result.problems.length).toBeGreaterThan(0)
    expect(result.problems.every((problem) => problem.severity === 'error')).toBe(true)
    expect(result.problems.map((problem) => problem.message).join('\n')).toMatch(/nodes/)
  })

  it('keeps a draft carrying an unrecognized field, with a warning', async () => {
    const tracked = startDraft()
    await stubAgentReports(draftedDefinition({ owner: 'someone' }))
    const result = await settled(tracked)

    expect(result.definition?.name).toBe('greeting')
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: 'workflow_unknown_key', severity: 'warning' })
    )
  })

  it('reports a planner that finished without a usable result as a draft problem', async () => {
    const tracked = startDraft()
    await stubAgentReports(null, { writeResult: false })
    const result = await settled(tracked)

    expect(result.definition).toBeUndefined()
    expect(result.problems).toEqual([
      expect.objectContaining({ code: 'workflow_draft_failed', severity: 'error' })
    ])
    expect(result.problems[0]?.message).toContain('result_missing')
  })

  it('refuses a draft larger than the result size cap', async () => {
    const tracked = startDraft()
    await stubAgentReports(draftedDefinition({ description: 'x'.repeat(300 * 1024) }))
    const result = await settled(tracked)

    expect(result.definition).toBeUndefined()
    expect(result.problems).toEqual([
      expect.objectContaining({ code: 'workflow_draft_too_large', severity: 'error' })
    ])
  })

  function workerMethods(): string[] {
    return workerCalls.mock.calls.map(([request]) => request.method)
  }

  function onlyRun() {
    const [run] = h.db.listWorkflowRuns().runs
    if (!run) {
      throw new Error('no planner run')
    }
    return run
  }

  it('marks the planner run with a version no workflow file can produce', async () => {
    const tracked = startDraft()
    await stubAgentReports(draftedDefinition())
    const result = await settled(tracked)

    const run = h.db.getWorkflowRun(result.runId)
    expect(run?.workflowVersion).toBe(DRAFT_PLANNER_RUN_VERSION)
    expect(run && isDraftPlannerRun(run)).toBe(true)
    expect(run?.workflowName).toBe(DRAFT_PLANNER_WORKFLOW_NAME)
  })

  it('runs a git repo draft in a setup-free run workspace, then releases its worker and removes it', async () => {
    const tracked = startDraft()
    await stubAgentReports(draftedDefinition())
    const result = await settled(tracked)

    expect(h.db.getWorkflowRun(result.runId)?.workflowSnapshot.workspacePolicy).toBe(
      'run-workspace'
    )
    expect(createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ setupDecision: 'skip' })
    )
    expect(workerMethods()).toContain('orchestration.workerRelease')
    expect(removeManagedWorktree).toHaveBeenCalledTimes(1)
    expect(removeManagedWorktree).toHaveBeenCalledWith(`id:${RUN_WORKTREE_ID}`)
    expect(h.db.listWorkflowEventsOfKind(result.runId, 'draft_run_torn_down')).toHaveLength(1)
    expect(h.db.listWorkflowEventsOfKind(result.runId, 'draft_worker_cleanup_failed')).toEqual([])
  })

  it('runs a folder repo draft in place through real placement and removes no worktree', async () => {
    await engine.stop()
    h.db.close()
    repo = { ...repo, kind: 'folder' }
    setUp(true)
    const tracked = startDraft()
    await stubAgentReports(draftedDefinition({ workspacePolicy: 'in-place' }))
    const result = await settled(tracked)

    expect(result.problems).toEqual([])
    expect(h.db.getWorkflowRun(result.runId)?.workflowSnapshot.workspacePolicy).toBe('in-place')
    expect(createManagedWorktree).not.toHaveBeenCalled()
    expect(removeManagedWorktree).not.toHaveBeenCalled()
    expect(workerMethods()).toContain('orchestration.workerRelease')
  })

  it('refuses an SSH repo whose host is unreachable, starting nothing', async () => {
    repo = { ...repo, connectionId: 'ssh-draft-unreachable' }
    const tracked = startDraft()
    await waitUntil(() => tracked.done)

    expect(tracked.error).toBeInstanceOf(Error)
    expect(tracked.error instanceof Error && tracked.error.message).toBe(
      'workflow_host_unreachable'
    )
    expect(h.db.listWorkflowRuns().runs).toHaveLength(0)
  })

  function tornDown(runId: string): boolean {
    return h.db.listWorkflowEventsOfKind(runId, 'draft_run_torn_down').length > 0
  }

  it('gives up before the planner question window closes, stopping the planner and removing its workspace', async () => {
    expect(DRAFT_DEADLINE_MS).toBeLessThan(600_000 + 300_000)
    confirmWorkerStops(h)
    const tracked = startDraft({ timeoutMs: 2_000 })
    await waitUntil(() => plannerAttempt()?.state === 'running')
    const result = await settled(tracked)

    expect(result.definition).toBeUndefined()
    expect(result.problems).toEqual([
      expect.objectContaining({ code: 'workflow_draft_timeout', severity: 'error' })
    ])
    expect(onlyRun().state).toBe('cancelled')
    expect(plannerAttempt()?.state).toBe('cancelled')
    expect(workerMethods()).toEqual(
      expect.arrayContaining(['orchestration.workerStop', 'orchestration.workerRelease'])
    )
    expect(removeManagedWorktree).toHaveBeenCalledWith(`id:${RUN_WORKTREE_ID}`)
    expect(tornDown(result.runId)).toBe(true)
  })

  it('cancels the planner and removes its workspace once an abort proves the worker stopped', async () => {
    confirmWorkerStops(h)
    const abort = new AbortController()
    const tracked = startDraft({ signal: abort.signal })
    await waitUntil(() => plannerAttempt()?.state === 'running')
    abort.abort()
    await waitUntil(() => tracked.done)

    expect(tracked.error instanceof Error && tracked.error.message).toBe('request_aborted')
    expect(onlyRun().state).toBe('cancelled')
    expect(plannerAttempt()?.state).toBe('cancelled')
    expect(workerMethods()).toContain('orchestration.workerRelease')
    expect(removeManagedWorktree).toHaveBeenCalledWith(`id:${RUN_WORKTREE_ID}`)
    expect(tornDown(onlyRun().id)).toBe(true)
  })

  it('leaves an unconfirmed stop retryable: attempt kept, workspace kept, run not torn down', async () => {
    const abort = new AbortController()
    const tracked = startDraft({ signal: abort.signal })
    await waitUntil(() => plannerAttempt()?.state === 'running')
    abort.abort()
    await waitUntil(() => tracked.done)

    const runId = onlyRun().id
    expect(onlyRun().state).toBe('cancelled')
    expect(plannerAttempt()?.state).toBe('running')
    expect(h.db.listWorkflowEventsOfKind(runId, 'draft_worker_stop_unconfirmed')).toHaveLength(1)
    expect(removeManagedWorktree).not.toHaveBeenCalled()
    expect(tornDown(runId)).toBe(false)

    const stopsBefore = workerMethods().filter((m) => m === 'orchestration.workerStop').length
    await sweepDraftRunsAtBoot({ db: h.db, runtime: h.runtime, dispatcher: h.dispatcher })
    expect(workerMethods().filter((m) => m === 'orchestration.workerStop').length).toBe(
      stopsBefore + 1
    )
  })

  it('stops a worker that was still starting when the caller aborted', async () => {
    const hold = holdNextWorkerTerminal(h)
    const abort = new AbortController()
    const tracked = startDraft({ signal: abort.signal })
    await waitUntil(() => hold.held())
    expect(plannerAttempt()?.state).toBe('provisioning')
    abort.abort()
    await vi.advanceTimersByTimeAsync(1_000)
    hold.release()
    await waitUntil(() => tracked.done)

    const dispatchId = plannerAttempt()?.dispatchId
    expect(dispatchId).toBeDefined()
    expect(
      workerCalls.mock.calls.some(
        ([request]) =>
          request.method === 'orchestration.workerStop' &&
          Reflect.get(Object(request.params), 'dispatch') === dispatchId
      )
    ).toBe(true)
  })
})

describe('resolveWorkflowPlannerAgent', () => {
  it('prefers the workflow planner setting, then the default agent, then claude', () => {
    expect(resolveWorkflowPlannerAgent({ workflowPlannerAgent: 'codex' })).toBe('codex')
    expect(resolveWorkflowPlannerAgent({ defaultTuiAgent: 'codex' })).toBe('codex')
    expect(resolveWorkflowPlannerAgent({ defaultTuiAgent: 'blank' })).toBe('claude')
    expect(resolveWorkflowPlannerAgent({ defaultTuiAgent: null })).toBe('claude')
    expect(resolveWorkflowPlannerAgent(undefined)).toBe('claude')
  })

  it('refuses to plan when every agent is disabled', () => {
    expect(() =>
      resolveWorkflowPlannerAgent({ disabledTuiAgents: [...TUI_AGENT_AUTO_PICK_ORDER] })
    ).toThrow(/every agent is disabled/i)
  })

  it('never picks a disabled agent', () => {
    expect(
      resolveWorkflowPlannerAgent({
        workflowPlannerAgent: 'codex',
        defaultTuiAgent: 'gemini',
        disabledTuiAgents: ['codex']
      })
    ).toBe('gemini')
    expect(
      resolveWorkflowPlannerAgent({
        defaultTuiAgent: 'claude',
        disabledTuiAgents: ['claude', 'claude-agent-teams']
      })
    ).toBe('openclaude')
  })
})
