import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import { listWorkflows } from './workflow-file-store'
import { WorkflowEngine } from './workflow-engine'
import { draftWorkflow, type WorkflowDraftResult } from './workflow-draft'
import {
  DRAFT_PLANNER_NODE_ID,
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

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-draft-'))
    h = createControllerHarness(workspaceRoot)
    repo = { id: 'repo', path: workspaceRoot, displayName: 'Repo', badgeColor: '#000', addedAt: 0 }
    removeManagedWorktree = vi.fn(async () => ({}))
    Object.assign(h.runtime, {
      createManagedWorktree: vi.fn(async () => ({
        worktree: { id: RUN_WORKTREE_ID, path: workspaceRoot, branch: 'wf-branch' }
      })),
      showManagedWorktree: vi.fn(async () => ({ id: RUN_WORKTREE_ID, path: workspaceRoot })),
      removeManagedWorktree
    })
    engine = new WorkflowEngine({
      db: h.db,
      runtime: h.runtime,
      dispatcher: h.dispatcher,
      getRepo: (repoId) => (repoId === repo.id ? repo : undefined)
    })
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
          worktrees: h.runtime,
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
        code: 'workflow_draft_node_unassigned',
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

  it('runs a git repo draft in its own run workspace and removes it once the planner settles', async () => {
    const tracked = startDraft()
    await stubAgentReports(draftedDefinition())
    const result = await settled(tracked)

    expect(h.db.getWorkflowRun(result.runId)?.workflowSnapshot.workspacePolicy).toBe(
      'run-workspace'
    )
    expect(removeManagedWorktree).toHaveBeenCalledWith(`id:${RUN_WORKTREE_ID}`)
  })

  it('runs a folder repo draft in place and creates no worktree', async () => {
    repo = { ...repo, kind: 'folder' }
    const tracked = startDraft()
    await stubAgentReports(draftedDefinition({ workspacePolicy: 'in-place' }))
    const result = await settled(tracked)

    expect(result.definition?.workspacePolicy).toBe('in-place')
    expect(h.db.getWorkflowRun(result.runId)?.workflowSnapshot.workspacePolicy).toBe('in-place')
    expect(h.runtime.createManagedWorktree).not.toHaveBeenCalled()
    expect(removeManagedWorktree).not.toHaveBeenCalled()
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

  it('gives up waiting after its deadline and leaves the still-running planner alone', async () => {
    const tracked = startDraft({ timeoutMs: 2_000 })
    await waitUntil(() => plannerAttempt()?.state === 'running')
    const result = await settled(tracked)

    expect(result.definition).toBeUndefined()
    expect(result.problems).toEqual([
      expect.objectContaining({ code: 'workflow_draft_timeout', severity: 'error' })
    ])
    expect(removeManagedWorktree).not.toHaveBeenCalled()
  })

  it('stops waiting when the caller aborts', async () => {
    const abort = new AbortController()
    const tracked = startDraft({ signal: abort.signal })
    await waitUntil(() => plannerAttempt()?.state === 'running')
    abort.abort()
    await waitUntil(() => tracked.done)

    expect(tracked.error instanceof Error && tracked.error.message).toBe('request_aborted')
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
})
