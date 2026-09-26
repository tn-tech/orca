import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import {
  createControllerHarness,
  RUN_WORKTREE_ID,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'
import { WorkflowEngine, WorkflowGraphValidationError } from './workflow-engine'

const ALWAYS_SUPPORTED = { agentSupportsModel: () => true }

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

  function createEngine(): WorkflowEngine {
    const engine = new WorkflowEngine({
      db: h.db,
      runtime: h.runtime,
      dispatcher: h.dispatcher,
      getRepo: (repoId) => (repoId === repo.id ? repo : undefined)
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
})
