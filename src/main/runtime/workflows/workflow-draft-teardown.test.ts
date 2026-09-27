import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import { buildDraftPlannerWorkflow, DRAFT_PLANNER_WORKFLOW_NAME } from './workflow-draft-planner'
import { sweepDraftRunsAtBoot, type DraftRunTeardownDeps } from './workflow-draft-teardown'
import { WorkflowEngine } from './workflow-engine'
import {
  createControllerHarness,
  RUN_WORKTREE_ID,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

describe('sweepDraftRunsAtBoot', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let repo: Repo
  let removeManagedWorktree: ReturnType<typeof vi.fn>
  let engines: WorkflowEngine[]

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-draft-sweep-'))
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
    engines = []
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

  function deps(): DraftRunTeardownDeps {
    return { db: h.db, runtime: h.runtime, dispatcher: h.dispatcher }
  }

  /** A planner run left running by a process that then went away. */
  async function orphanedPlannerRun(): Promise<string> {
    const first = createEngine()
    const run = await first.startRun({
      workflow: buildDraftPlannerWorkflow(repo, 'claude'),
      workflowSource: 'project',
      workflowVersion: DRAFT_PLANNER_WORKFLOW_NAME,
      objective: 'draft something',
      repo,
      validation: { agentSupportsModel: () => true }
    })
    await waitUntil(() => h.db.listWorkflowAttempts(run.id).some((a) => a.state === 'running'))
    await first.stop()
    return run.id
  }

  it('cancels an orphaned planner run before rehydrate, then stops it and removes its workspace', async () => {
    const runId = await orphanedPlannerRun()
    const workersBefore = h.workerHandles.length

    const sweep = sweepDraftRunsAtBoot(deps())
    expect(h.db.getWorkflowRun(runId)?.state).toBe('cancelled')
    createEngine().rehydrateActiveRuns()
    await sweep

    expect(h.workerHandles).toHaveLength(workersBefore)
    expect(h.db.listWorkflowAttempts(runId).find((a) => a.nodeId === 'plan')?.state).toBe(
      'cancelled'
    )
    expect(removeManagedWorktree).toHaveBeenCalledWith(`id:${RUN_WORKTREE_ID}`)
    expect(h.db.listWorkflowEventsOfKind(runId, 'draft_run_torn_down')).toHaveLength(1)

    await sweepDraftRunsAtBoot(deps())
    expect(removeManagedWorktree).toHaveBeenCalledTimes(1)
  })

  it('leaves ordinary workflow runs alone', async () => {
    const engine = createEngine()
    const run = await engine.startRun({
      workflow: TWO_NODE_WORKFLOW,
      workflowSource: 'project',
      workflowVersion: 'v1',
      objective: 'ordinary',
      repo,
      validation: { agentSupportsModel: () => true }
    })
    await sweepDraftRunsAtBoot(deps())

    expect(h.db.getWorkflowRun(run.id)?.state).not.toBe('cancelled')
    expect(removeManagedWorktree).not.toHaveBeenCalled()
  })

  it('records a failed workspace removal and retries it on the next boot', async () => {
    const runId = await orphanedPlannerRun()
    removeManagedWorktree.mockRejectedValueOnce(new Error('worktree is dirty'))

    await sweepDraftRunsAtBoot(deps())
    expect(h.db.listWorkflowEventsOfKind(runId, 'draft_workspace_remove_failed')).toHaveLength(1)
    expect(h.db.listWorkflowEventsOfKind(runId, 'draft_run_torn_down')).toHaveLength(0)

    await sweepDraftRunsAtBoot(deps())
    expect(removeManagedWorktree).toHaveBeenCalledTimes(2)
    expect(h.db.listWorkflowEventsOfKind(runId, 'draft_run_torn_down')).toHaveLength(1)
  })
})
