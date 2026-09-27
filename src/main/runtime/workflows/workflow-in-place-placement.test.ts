// In-place runs (FR-041) place their workers through the runtime's real workspace selectors: a
// bare repo id is never a worktree id (`worktree_id_requires_full_path`), so the engine must hand
// worker-start the repo's own checkout id, and must do so for rows persisted with the bare id.
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import { getRepoMainWorktreeId } from '../../../shared/worktree/id'
import { gitExecFileAsync } from '../../git/runner'
import { WorkflowEngine } from './workflow-engine'
import { startRerun } from './workflow-rerun'
import { createControllerHarness, waitUntil } from './workflow-run-controller-test-harness'
import { storeFor } from './workflow-placement-test-fixtures'

const IN_PLACE_AGENT_WORKFLOW: Workflow = {
  version: 1,
  name: 'in-place-agent',
  workspacePolicy: 'in-place',
  roles: {
    dev: { id: 'dev', name: 'Developer', agent: 'codex', systemPrompt: 'Do it.', skills: [] }
  },
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    {
      id: 'work',
      type: 'agent',
      title: 'Work',
      roleId: 'dev',
      prompt: 'Work on ${objective}.',
      workspace: 'run',
      resultContract: { type: 'object' },
      artifacts: [],
      question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
    },
    { id: 'end', type: 'end', title: 'End' }
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'work' },
    { id: 'e2', from: 'work', to: 'end' }
  ],
  layout: {}
}

describe('in-place workflow worker placement (real workspace resolution)', () => {
  let repoPath: string
  let engine: WorkflowEngine | undefined

  beforeEach(async () => {
    // Real path: git lists worktrees by it (macOS tmpdir is a /private symlink).
    repoPath = await realpath(await mkdtemp(join(tmpdir(), 'workflow-in-place-')))
  })

  afterEach(async () => {
    await engine?.stop()
    engine = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
    await rm(repoPath, { recursive: true, force: true })
  })

  async function setUp(repo: Repo) {
    const h = createControllerHarness(repoPath, { store: storeFor(repo) })
    const showWorkspace = vi.spyOn(h.runtime, 'showManagedTerminalWorkspace')
    engine = new WorkflowEngine({
      db: h.db,
      runtime: h.runtime,
      dispatcher: h.dispatcher,
      getRepo: (repoId) => (repoId === repo.id ? repo : undefined)
    })
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
    return { h, showWorkspace, engine }
  }

  function workAttempt(h: ReturnType<typeof createControllerHarness>, runId: string) {
    return h.db.listWorkflowAttempts(runId).find((attempt) => attempt.nodeId === 'work')
  }

  async function expectPlacedInCheckout(repo: Repo): Promise<void> {
    const { h, showWorkspace, engine: started } = await setUp(repo)
    const run = await started.startRun({
      workflow: IN_PLACE_AGENT_WORKFLOW,
      workflowSource: 'project',
      workflowVersion: 'v1',
      objective: 'place me',
      repo,
      validation: { agentSupportsModel: () => true }
    })
    await waitUntil(() => {
      const state = workAttempt(h, run.id)?.state
      return state === 'running' || state === 'failed'
    })
    expect(workAttempt(h, run.id)?.failureReason).toBeUndefined()
    expect(workAttempt(h, run.id)?.state).toBe('running')
    expect(showWorkspace).toHaveBeenCalledWith(`id:${getRepoMainWorktreeId(repo)}`)
    h.db.close()
  }

  it('places a git repo run in the repo checkout', async () => {
    await gitExecFileAsync(['init', '-q'], { cwd: repoPath })
    await expectPlacedInCheckout({
      id: 'repo-git',
      path: repoPath,
      displayName: 'Git',
      badgeColor: '#000',
      addedAt: 0
    })
  })

  it('places a folder repo run in the folder workspace', async () => {
    await expectPlacedInCheckout({
      id: 'repo-folder',
      path: repoPath,
      displayName: 'Folder',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'folder'
    })
  })

  it('places a rehydrated run whose persisted row carries the bare repo id', async () => {
    const repo: Repo = {
      id: 'repo-legacy',
      path: repoPath,
      displayName: 'Legacy',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'folder'
    }
    const { h, showWorkspace, engine: rehydrating } = await setUp(repo)
    const run = h.db.createWorkflowRun({
      workflowName: IN_PLACE_AGENT_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: IN_PLACE_AGENT_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'placed before the fix',
      repoId: repo.id,
      worktreeId: repo.id
    })
    rehydrating.rehydrateActiveRuns()
    await waitUntil(() => {
      const state = workAttempt(h, run.id)?.state
      return state === 'running' || state === 'failed'
    })
    expect(workAttempt(h, run.id)?.failureReason).toBeUndefined()
    expect(showWorkspace).toHaveBeenCalledWith(`id:${getRepoMainWorktreeId(repo)}`)
    h.db.close()
  })

  it('places a rerun of a failed in-place run in the checkout, not its stored row id', async () => {
    const repo: Repo = {
      id: 'repo-rerun',
      path: repoPath,
      displayName: 'Rerun',
      badgeColor: '#000',
      addedAt: 0,
      kind: 'folder'
    }
    const { h, showWorkspace, engine: started } = await setUp(repo)
    const source = h.db.createWorkflowRun({
      workflowName: IN_PLACE_AGENT_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: IN_PLACE_AGENT_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'failed once',
      repoId: repo.id,
      worktreeId: repo.id
    })
    for (const [nodeId, nodeType, states] of [
      ['start', 'start', ['provisioning', 'running', 'completed']],
      ['work', 'agent', ['provisioning', 'running', 'failed']]
    ] as const) {
      const attempt = h.db.createWorkflowAttempt({ runId: source.id, nodeId, nodeType })
      states.forEach((state) => h.db.transitionWorkflowAttempt(attempt.id, state))
    }
    h.db.transitionWorkflowRun(source.id, 'running')
    h.db.transitionWorkflowRun(source.id, 'failed')

    const rerun = await startRerun(
      {
        db: h.db,
        launch: (run) => started.launch(run),
        resolveRepo: async () => repo,
        showManagedWorktree: (selector) => h.runtime.showManagedWorktree(selector),
        validation: { agentSupportsModel: () => true }
      },
      { runId: source.id }
    )
    await waitUntil(() => {
      const state = workAttempt(h, rerun.id)?.state
      return state === 'running' || state === 'failed'
    })
    expect(workAttempt(h, rerun.id)?.failureReason).toBeUndefined()
    expect(workAttempt(h, rerun.id)?.state).toBe('running')
    expect(showWorkspace).toHaveBeenCalledWith(`id:${getRepoMainWorktreeId(repo)}`)
    h.db.close()
  })
})
