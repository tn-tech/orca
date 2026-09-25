import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationDb } from '../../../../orchestration/db'
import type { RpcContext } from '../../../core'
import { ORCHESTRATION_METHODS } from '../../orchestration'
import {
  engineCoordinatorHandle,
  engineCoordinatorPaneKey,
  type WorkflowEnginePrincipal
} from '../../../../workflows/workflow-engine-principal'

const WORKFLOW_RUN_ID = 'wfr_00000000e001'
const ENGINE_HANDLE = engineCoordinatorHandle(WORKFLOW_RUN_ID)
const COORDINATOR_PANE_KEY = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('orchestration.workerStart with the workflow-engine principal', () => {
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let engineRunId: string
  let principal: WorkflowEnginePrincipal

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    engineRunId = db.createWorkflowEngineRun({
      workflowRunId: WORKFLOW_RUN_ID,
      objective: 'engine run'
    }).id
    db.createRun({
      objective: 'terminal run',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: COORDINATOR_PANE_KEY
    })
    principal = { kind: 'workflow-engine', workflowRunId: WORKFLOW_RUN_ID, worktreeId: 'repo::run' }
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord'
        ? COORDINATOR_PANE_KEY
        : handle === 'term_worker'
          ? 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
          : null
    )
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockImplementation((handle) =>
      handle === 'term_worker' ? 'runtime_test:term_worker:1' : null
    )
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showTerminal')
    vi.spyOn(runtime, 'createTerminal')
    // Partial fakes: only the fields worker-start reads.
    Object.assign(runtime, {
      showManagedWorktree: vi.fn(async () => ({ id: 'repo::run', repoId: 'repo' })),
      showRepo: vi.fn(async () => ({ id: 'repo', kind: 'git' })),
      createManagedWorktree: vi.fn(async () => ({
        worktree: { id: 'repo::child', repoId: 'repo' },
        startupTerminal: { spawned: true, handle: 'term_worker' },
        setupReceipt: {
          requested: 'run',
          hookFound: false,
          startupPolicy: 'start-immediately',
          state: 'not_configured'
        }
      })),
      listTerminals: vi.fn(async () => ({
        terminals: [{ handle: 'term_worker', title: 'Codex' }],
        totalCount: 1,
        truncated: false
      }))
    })
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
      handle: 'term_worker',
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    })
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: 'term_worker',
      accepted: true,
      bytesWritten: 1
    })
  })

  afterEach(() => {
    db.close()
  })

  async function startWorker(overrides: Record<string, unknown>, ctx: Partial<RpcContext>) {
    const method = ORCHESTRATION_METHODS.find((m) => m.name === 'orchestration.workerStart')
    if (!method?.params) {
      throw new Error('workerStart method is not registered')
    }
    const params = method.params.parse({
      spec: 'implement the node',
      from: ENGINE_HANDLE,
      worktree: 'new-child',
      name: 'wf-implement',
      agent: 'codex',
      ...overrides
    })
    return method.handler(params, { runtime, ...ctx })
  }

  it('starts a local worker in the engine workspace with model and effort', async () => {
    const result = await startWorker({ model: 'custom-codex-model', effort: 'high' }, { principal })

    expect(result).toMatchObject({
      state: 'ready',
      launch: {
        requested: { agent: 'codex', model: 'custom-codex-model', effort: 'high' },
        effective: { agent: 'codex', model: 'custom-codex-model', effort: 'high' }
      }
    })
    expect(runtime.showTerminal).not.toHaveBeenCalled()
    expect(runtime.showManagedWorktree).toHaveBeenCalledWith('id:repo::run')
    expect(runtime.createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        startupAgent: 'codex',
        startupLaunchPreferences: { model: 'custom-codex-model', effort: 'high' }
      })
    )
    const tasks = db.listTasks({ runId: engineRunId })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      created_by_terminal_handle: ENGINE_HANDLE,
      created_by_pane_key: engineCoordinatorPaneKey(WORKFLOW_RUN_ID)
    })
    expect(db.getDispatchContext(tasks[0].id)).toMatchObject({ creator_handle: null })
  })

  it('refuses --terminal reuse before any effect', async () => {
    await expect(startWorker({ terminal: 'term_existing' }, { principal })).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    expect(db.listTasks()).toEqual([])
  })

  it('refuses a principal with no workspace and a foreign --from', async () => {
    await expect(
      startWorker({}, { principal: { kind: 'workflow-engine', workflowRunId: WORKFLOW_RUN_ID } })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(startWorker({ from: 'term_coord' }, { principal })).rejects.toMatchObject({
      code: 'consumer_fenced'
    })
    expect(db.listTasks()).toEqual([])
  })

  it('refuses a terminal coordinator targeting the engine-owned Run', async () => {
    await expect(startWorker({ from: 'term_coord', run: engineRunId }, {})).rejects.toMatchObject({
      code: 'workflow_owned_run'
    })
    expect(db.listTasks()).toEqual([])
  })

  it('ignores an engine identity claimed only through params', async () => {
    await expect(startWorker({}, {})).rejects.toMatchObject({ code: 'consumer_fenced' })
    expect(runtime.createManagedWorktree).not.toHaveBeenCalled()
  })
})
