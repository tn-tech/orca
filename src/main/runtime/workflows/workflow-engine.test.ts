import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IFilesystemProvider } from '../../providers/types'
import {
  registerSshFilesystemProvider,
  unregisterSshFilesystemProvider
} from '../../providers/ssh-filesystem-dispatch'
import type { Repo } from '../../../shared/repo-types'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import {
  createControllerHarness,
  RUN_WORKTREE_ID,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'
import { WorkflowRunController } from './workflow-run-controller'
import {
  WorkflowEngine,
  WorkflowGraphValidationError,
  type WorkflowEngineDeps
} from './workflow-engine'

const ALWAYS_SUPPORTED = { agentSupportsModel: () => true }

// Start -> End only: settles with no worker dispatch, so SSH/host-unreachable tests don't need
// the PTY/dispatcher fakes an agent-node run requires.
const TRIVIAL_WORKFLOW: Workflow = {
  version: 1,
  name: 'trivial',
  workspacePolicy: 'in-place',
  roles: {},
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    { id: 'end', type: 'end', title: 'Done' }
  ],
  edges: [{ id: 'e1', from: 'start', to: 'end' }],
  layout: {}
}

function repoFixture(path: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo',
    path,
    displayName: 'Repo',
    badgeColor: '#000',
    addedAt: 0,
    ...overrides
  }
}

/** Every member throws: this test never exercises the provider, only that one is registered. */
function unusedFilesystemProvider(): IFilesystemProvider {
  const notUsed = (name: string) => (): never => {
    throw new Error(`${name} is not used by this test`)
  }
  return {
    readDir: notUsed('readDir'),
    readFile: notUsed('readFile'),
    writeFile: notUsed('writeFile'),
    writeFileBase64: notUsed('writeFileBase64'),
    writeFileBase64Chunk: notUsed('writeFileBase64Chunk'),
    stat: notUsed('stat'),
    deletePath: notUsed('deletePath'),
    createFile: notUsed('createFile'),
    createDir: notUsed('createDir'),
    createDirNoClobber: notUsed('createDirNoClobber'),
    rename: notUsed('rename'),
    renameNoClobber: notUsed('renameNoClobber'),
    copy: notUsed('copy'),
    realpath: notUsed('realpath'),
    search: notUsed('search'),
    listFiles: notUsed('listFiles'),
    watch: notUsed('watch')
  }
}

describe('WorkflowEngine', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let repo: Repo
  let engines: WorkflowEngine[]

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-engine-'))
    h = createControllerHarness(workspaceRoot)
    // Real directory (not the run's own worktree) so ensureOrcaDirIgnored has somewhere to write.
    repo = repoFixture(workspaceRoot)
    engines = []
    // Partial fakes: createRunWorkspace/resolveWorkspace only read id/path/branch off these.
    Object.assign(h.runtime, {
      createManagedWorktree: vi.fn(async () => ({
        worktree: { id: RUN_WORKTREE_ID, path: workspaceRoot, branch: 'wf-branch' }
      })),
      showManagedWorktree: vi.fn(async () => ({ id: RUN_WORKTREE_ID, path: workspaceRoot }))
    })
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  })

  afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.stop()))
    vi.useRealTimers()
    vi.restoreAllMocks()
    h.db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  function createEngine(overrides: Partial<WorkflowEngineDeps> = {}): WorkflowEngine {
    const engine = new WorkflowEngine({
      db: h.db,
      runtime: h.runtime,
      dispatcher: h.dispatcher,
      getRepo: (repoId) => (repoId === repo.id ? repo : undefined),
      ...overrides
    })
    engines.push(engine)
    return engine
  }

  function attempt(runId: string, nodeId: string): NodeAttemptView | undefined {
    return h.db.listWorkflowAttempts(runId).find((candidate) => candidate.nodeId === nodeId)
  }

  function requireAttempt(
    runId: string,
    nodeId: string
  ): Required<Pick<NodeAttemptView, 'taskId' | 'dispatchId' | 'resultPath'>> {
    const found = attempt(runId, nodeId)
    if (!found?.taskId || !found.dispatchId || !found.resultPath) {
      throw new Error(`attempt for ${nodeId} is not dispatched`)
    }
    return { taskId: found.taskId, dispatchId: found.dispatchId, resultPath: found.resultPath }
  }

  async function completeNode(runId: string, nodeId: string, handle: string, result: unknown) {
    const dispatched = requireAttempt(runId, nodeId)
    await h.writeResult(dispatched.resultPath, result)
    const response = await h.sendWorkerDone({
      handle,
      taskId: dispatched.taskId,
      dispatchId: dispatched.dispatchId,
      reportPath: dispatched.resultPath
    })
    expect(response).toMatchObject({ ok: true, result: { lifecycle: { action: 'completed' } } })
  }

  it('startRun validates, creates the workspace and row, then drives the run to completion', async () => {
    const engine = createEngine()
    const run = await engine.startRun({
      workflow: TWO_NODE_WORKFLOW,
      workflowSource: 'project',
      workflowVersion: 'v1',
      objective: 'add a greeting',
      repo,
      validation: ALWAYS_SUPPORTED
    })
    expect(run.state).toBe('queued')
    expect(run.worktreeId).toBe(RUN_WORKTREE_ID)
    expect(h.runtime.createManagedWorktree).toHaveBeenCalledWith({
      repoSelector: 'id:repo',
      name: `two-node-${run.id}`
    })

    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    await completeNode(run.id, 'implement', 'term_worker_1', { summary: 'ok' })
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    await completeNode(run.id, 'review', 'term_worker_2', { verdict: 'approved' })
    await waitUntil(() => engine.getSnapshot(run.id)?.state === 'completed')
    expect(engine.getSnapshot(run.id)?.state).toBe('completed')
  })

  it('honors the workflow file concurrencyLimit when no override is given (FR-031)', async () => {
    const engine = createEngine()
    const run = await engine.startRun({
      workflow: { ...TRIVIAL_WORKFLOW, concurrencyLimit: 7 },
      workflowSource: 'project',
      workflowVersion: 'v1',
      objective: 'honor the file default',
      repo,
      validation: ALWAYS_SUPPORTED
    })
    expect(run.concurrencyLimit).toBe(7)
    expect(engine.getSnapshot(run.id)?.concurrencyLimit).toBe(7)
  })

  it('lets a workflow.run.start override win over the workflow file concurrencyLimit', async () => {
    const engine = createEngine()
    const run = await engine.startRun({
      workflow: { ...TRIVIAL_WORKFLOW, concurrencyLimit: 7 },
      workflowSource: 'project',
      workflowVersion: 'v1',
      objective: 'override wins',
      repo,
      concurrencyLimit: 2,
      validation: ALWAYS_SUPPORTED
    })
    expect(run.concurrencyLimit).toBe(2)
  })

  it('defaults concurrencyLimit to 4 when neither the workflow file nor an override sets one', async () => {
    const engine = createEngine()
    const run = await engine.startRun({
      workflow: TRIVIAL_WORKFLOW,
      workflowSource: 'project',
      workflowVersion: 'v1',
      objective: 'default limit',
      repo,
      validation: ALWAYS_SUPPORTED
    })
    expect(run.concurrencyLimit).toBe(4)
  })

  it('rejects an invalid graph before creating any workspace or row', async () => {
    const engine = createEngine()
    const invalid: Workflow = {
      version: 1,
      name: 'no-start',
      workspacePolicy: 'in-place',
      roles: {},
      nodes: [],
      edges: [],
      layout: {}
    }
    await expect(
      engine.startRun({
        workflow: invalid,
        workflowSource: 'project',
        workflowVersion: 'v1',
        objective: 'nope',
        repo,
        validation: ALWAYS_SUPPORTED
      })
    ).rejects.toBeInstanceOf(WorkflowGraphValidationError)
    expect(h.runtime.createManagedWorktree).not.toHaveBeenCalled()
    expect(h.db.listWorkflowRuns().runs).toHaveLength(0)
  })

  it('getSnapshot reads through to the DB and is undefined for an unknown run', () => {
    const engine = createEngine()
    expect(engine.getSnapshot('wfr_missing')).toBeUndefined()
  })

  it('rehydrates an active run after a simulated restart with no run id given to the new engine', async () => {
    const first = createEngine()
    const run = await first.startRun({
      workflow: TWO_NODE_WORKFLOW,
      workflowSource: 'project',
      workflowVersion: 'v1',
      objective: 'add a greeting',
      repo,
      validation: ALWAYS_SUPPORTED
    })
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')

    // Simulated restart: the process (and its in-memory registry) is gone, but the DB and the
    // worker's eventual report survive it.
    await first.stop()
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('running')
    await completeNode(run.id, 'implement', 'term_worker_1', { summary: 'while down' })
    expect(attempt(run.id, 'implement')?.state).toBe('running')

    const second = createEngine()
    second.rehydrateActiveRuns()
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    expect(attempt(run.id, 'implement')?.state).toBe('completed')
    expect(h.workerHandles).toEqual(['term_worker_1', 'term_worker_2'])

    await completeNode(run.id, 'review', 'term_worker_2', { verdict: 'approved' })
    await waitUntil(() => second.getSnapshot(run.id)?.state === 'completed')
    expect(second.getSnapshot(run.id)?.state).toBe('completed')
  })

  it('rehydrates an SSH-repo run without failing it while unreachable, then completes it once the provider registers', async () => {
    const connectionId = `conn-ssh-${Math.random().toString(36).slice(2)}`
    const sshRepo = repoFixture(workspaceRoot, { id: 'ssh-repo', connectionId })
    const engine = createEngine({
      getRepo: (repoId) => (repoId === sshRepo.id ? sshRepo : undefined),
      hostUnreachableRetryDelayMs: 20
    })
    const run = h.db.createWorkflowRun({
      workflowName: TRIVIAL_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: TRIVIAL_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'ssh host unreachable at boot',
      repoId: sshRepo.id,
      worktreeId: sshRepo.id
    })

    engine.rehydrateActiveRuns()
    // The failure is pure microtask chaining (no timers, no real I/O) so one real tick settles it.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('queued')
    expect(h.db.listWorkflowEvents(run.id).some((event) => event.kind === 'run_engine_error')).toBe(
      false
    )

    try {
      registerSshFilesystemProvider(connectionId, unusedFilesystemProvider())
      await waitUntil(() => h.db.getWorkflowRun(run.id)?.state === 'completed')
    } finally {
      unregisterSshFilesystemProvider(connectionId)
    }
  })

  it('refuses startRun once stopped', async () => {
    const engine = createEngine()
    await engine.stop()

    await expect(
      engine.startRun({
        workflow: TRIVIAL_WORKFLOW,
        workflowSource: 'project',
        workflowVersion: 'v1',
        objective: 'too late',
        repo,
        validation: ALWAYS_SUPPORTED
      })
    ).rejects.toThrow('workflow_engine_stopped')
  })

  it('does not launch a controller for a startRun already in flight when stop() runs first', async () => {
    const engine = createEngine()
    const startPromise = engine.startRun({
      workflow: TRIVIAL_WORKFLOW,
      workflowSource: 'project',
      workflowVersion: 'v1',
      objective: 'race with stop',
      repo,
      validation: ALWAYS_SUPPORTED
    })

    // engine.stop() sets its `stopped` flag synchronously, before startRun's own async work
    // (allowlist read, workspace creation, row insert) can resume and reach launch().
    await engine.stop()
    const run = await startPromise

    // The row exists (workspace-then-row already happened), but nothing ever drove it forward.
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('queued')
  })

  it('removes the just-created worktree if inserting the run row fails', async () => {
    const engine = createEngine()
    vi.spyOn(h.db, 'createWorkflowRun').mockImplementationOnce(() => {
      throw new Error('simulated insert failure')
    })
    const removeManagedWorktree = vi.fn(async () => ({}))
    Object.assign(h.runtime, { removeManagedWorktree })

    await expect(
      engine.startRun({
        workflow: TWO_NODE_WORKFLOW,
        workflowSource: 'project',
        workflowVersion: 'v1',
        objective: 'row insert fails',
        repo,
        validation: ALWAYS_SUPPORTED
      })
    ).rejects.toThrow('simulated insert failure')

    expect(h.runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
    expect(removeManagedWorktree).toHaveBeenCalledWith(`id:${RUN_WORKTREE_ID}`)
  })

  it('bounds stop() with a deadline so a controller stuck mid-tick cannot hang shutdown', async () => {
    const engine = createEngine({ shutdownDeadlineMs: 10 })
    const run = await engine.startRun({
      workflow: TWO_NODE_WORKFLOW,
      workflowSource: 'project',
      workflowVersion: 'v1',
      objective: 'stuck controller',
      repo,
      validation: ALWAYS_SUPPORTED
    })
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    // Simulates a controller whose abort didn't make its current tick yield in time.
    vi.spyOn(WorkflowRunController.prototype, 'stop').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const stopPromise = engine.stop()
    await vi.advanceTimersByTimeAsync(50)
    await stopPromise

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('exceeded its 10ms deadline')
  })

  it('records a person’s answer to an agent question for the run’s controller to deliver', () => {
    const engine = createEngine()
    const run = h.createRun()
    const asked = h.db.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_asker',
      kind: 'agent-question',
      prompt: 'Which database?'
    })
    expect(engine.answerAgentQuestion(run.id, asked.id, 'postgres', 'user_1')).toMatchObject({
      state: 'answered',
      answer: 'postgres',
      answeredBy: 'user_1'
    })
    expect(h.db.listWorkflowEvents(run.id).map((event) => event.kind)).toContain(
      'agent_question_answered'
    )
  })
})
