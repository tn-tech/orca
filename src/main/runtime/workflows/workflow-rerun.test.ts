import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { AgentNode, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView, RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import { approvalDriver } from './workflow-approval-test-fixtures'
import { DRAFT_PLANNER_RUN_VERSION } from './workflow-draft-planner'
import { WorkflowEngine } from './workflow-engine'
import { readPath } from './workflow-follow-up-interrupt'
import { startRerun, type WorkflowRerunDeps } from './workflow-rerun'
import {
  createControllerHarness,
  RUN_WORKTREE_ID,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'

const ARTIFACT = 'notes/plan.md'

function agent(
  id: string,
  prompt: string,
  required: string[],
  artifacts: AgentNode['artifacts'] = []
): AgentNode {
  return {
    id,
    type: 'agent',
    title: id,
    roleId: 'developer',
    prompt,
    workspace: 'run',
    resultContract: {
      type: 'object',
      required,
      properties: Object.fromEntries(required.map((key) => [key, { type: 'string' }]))
    },
    artifacts,
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
  }
}

/** start -> implement (writes an artifact) -> review -> verify -> end; verify is the third node. */
const THREE_NODE_WORKFLOW: Workflow = {
  ...TWO_NODE_WORKFLOW,
  name: 'three-node',
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    agent(
      'implement',
      'Implement ${objective}.',
      ['summary'],
      [{ path: ARTIFACT, required: true }]
    ),
    agent('review', 'Review ${upstream.implement.result.summary}.', ['verdict']),
    agent(
      'verify',
      'Verify ${upstream.review.result.verdict} against ${upstream.implement.artifacts}.',
      ['status']
    ),
    { id: 'end', type: 'end', title: 'Done' }
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'implement' },
    { id: 'e2', from: 'implement', to: 'review' },
    { id: 'e3', from: 'review', to: 'verify' },
    { id: 'e4', from: 'verify', to: 'end' }
  ]
}

/** start -> qa loop (implement -> review, exits on approved) -> end. */
const LOOP_WORKFLOW: Workflow = {
  ...TWO_NODE_WORKFLOW,
  name: 'qa-loop',
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    {
      id: 'qa',
      type: 'loop',
      title: 'QA loop',
      body: { nodeIds: ['implement', 'review'] },
      entryNodeId: 'implement',
      exitNodeId: 'review',
      maxIterations: 3,
      exitCondition: { path: 'verdict', op: 'eq', value: 'approved' },
      onCapReached: 'fail'
    },
    agent('implement', 'Implement.', ['summary']),
    agent('review', 'Review.', ['verdict']),
    { id: 'end', type: 'end', title: 'Done' }
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'qa' },
    { id: 'e2', from: 'implement', to: 'review' },
    { id: 'e3', from: 'review', to: 'implement', fromPort: 'body' },
    { id: 'e4', from: 'qa', to: 'end', fromPort: 'exit' }
  ]
}

describe('workflow rerun from a node (FR-030, US8 AS2)', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof approvalDriver>
  let repo: Repo
  let engine: WorkflowEngine
  let createManagedWorktree: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-rerun-'))
    h = createControllerHarness(workspaceRoot)
    d = approvalDriver(h)
    repo = { id: 'repo', path: workspaceRoot, displayName: 'Repo', badgeColor: '#000', addedAt: 0 }
    createManagedWorktree = vi.fn(async () => ({
      worktree: { id: RUN_WORKTREE_ID, path: workspaceRoot, branch: 'wf-branch' }
    }))
    Object.assign(h.runtime, {
      createManagedWorktree,
      showManagedWorktree: vi.fn(async () => ({ id: RUN_WORKTREE_ID, path: workspaceRoot })),
      removeManagedWorktree: vi.fn(async () => ({}))
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

  function deps(): WorkflowRerunDeps {
    return {
      db: h.db,
      launch: (run) => engine.launch(run),
      resolveRepo: async (repoId) => {
        if (repoId !== repo.id) {
          throw new Error('repo_not_found')
        }
        return repo
      },
      showManagedWorktree: (selector) => h.runtime.showManagedWorktree(selector),
      validation: { agentSupportsModel: () => true }
    }
  }

  const attemptsOf = (runId: string, nodeId: string): NodeAttemptView[] =>
    h.db.listWorkflowAttempts(runId).filter((attempt) => attempt.nodeId === nodeId)

  async function touchArtifact(): Promise<void> {
    await mkdir(join(workspaceRoot, dirname(ARTIFACT)), { recursive: true })
    await writeFile(join(workspaceRoot, ARTIFACT), '# plan', 'utf-8')
  }

  async function startSource(workflow: Workflow = THREE_NODE_WORKFLOW): Promise<RunSnapshot> {
    return engine.startRun({
      workflow,
      workflowSource: 'project',
      workflowVersion: 'rev-1',
      objective: 'add a greeting',
      repo,
      validation: { agentSupportsModel: () => true }
    })
  }

  /** implement and review succeed; verify breaks its contract, so the run fails at node three. */
  async function failAtThirdNode(): Promise<RunSnapshot> {
    const source = await startSource()
    await touchArtifact()
    await d.report(source.id, 'implement', { summary: 'greeting added' })
    await d.report(source.id, 'review', { verdict: 'approved' })
    await d.reached(source.id, 'verify', 'running')
    await d.report(source.id, 'verify', { status: 42 })
    await waitUntil(() => h.db.getWorkflowRun(source.id)?.state === 'failed')
    await engine.whenControllerSettled(source.id)
    return source
  }

  it('reruns from the failed node: upstream results are copied, only it and its descendants run', async () => {
    const source = await failAtThirdNode()
    const workersBefore = h.workerHandles.length

    const rerun = await startRerun(deps(), {
      runId: source.id,
      fromNodeId: 'verify',
      startedByClient: 'device_1'
    })

    expect(rerun).toMatchObject({
      rerunOfRunId: source.id,
      rerunFromNodeId: 'verify',
      workflowVersion: 'rev-1',
      worktreeId: source.worktreeId,
      startedByClient: 'device_1'
    })
    await d.reached(rerun.id, 'verify', 'running')
    const sourceImplement = attemptsOf(source.id, 'implement')[0]
    const [implement] = attemptsOf(rerun.id, 'implement')
    expect(implement).toMatchObject({
      state: 'completed',
      resultJson: { summary: 'greeting added' },
      artifactsJson: sourceImplement.artifactsJson,
      resultPath: sourceImplement.resultPath,
      dispatchId: sourceImplement.dispatchId
    })
    expect(implement.id).not.toBe(sourceImplement.id)
    expect(attemptsOf(rerun.id, 'review')[0]).toMatchObject({
      state: 'completed',
      resultJson: { verdict: 'approved' }
    })
    // One new worker, for verify; the upstream nodes were not executed again.
    expect(h.workerHandles).toHaveLength(workersBefore + 1)
    expect(createManagedWorktree).toHaveBeenCalledTimes(1)
    // Copied artifacts are in the workspace the rerun uses, and reach verify's brief.
    await expect(stat(join(workspaceRoot, ARTIFACT))).resolves.toBeDefined()
    const brief = await readFile(
      join(workspaceRoot, attemptsOf(rerun.id, 'verify')[0].briefPath ?? ''),
      'utf-8'
    )
    expect(brief).toContain('Verify approved against')
    expect(brief).toContain(ARTIFACT)
    const copied = h.db.listWorkflowEventsOfKind(rerun.id, 'attempt_copied')
    expect(copied.map((event) => event.payloadJson)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'implement', sourceAttemptId: sourceImplement.id })
      ])
    )

    await d.report(rerun.id, 'verify', { status: 'green' })
    await waitUntil(() => h.db.getWorkflowRun(rerun.id)?.state === 'completed')
    expect(h.db.getWorkflowRun(source.id)?.state).toBe('failed')
    expect(attemptsOf(source.id, 'verify')).toHaveLength(1)
  })

  it('defaults to the failed node and can rerun from an earlier node', async () => {
    const source = await failAtThirdNode()
    const byDefault = await startRerun(deps(), { runId: source.id })
    expect(byDefault.rerunFromNodeId).toBe('verify')
    await d.reached(byDefault.id, 'verify', 'running')
    await d.report(byDefault.id, 'verify', { status: 42 })
    await waitUntil(() => h.db.getWorkflowRun(byDefault.id)?.state === 'failed')
    await engine.whenControllerSettled(byDefault.id)

    const fromReview = await startRerun(deps(), { runId: byDefault.id, fromNodeId: 'review' })
    await d.reached(fromReview.id, 'review', 'running')
    expect(attemptsOf(fromReview.id, 'implement')[0]?.state).toBe('completed')
    expect(attemptsOf(fromReview.id, 'verify')).toEqual([])
  })

  it('reruns a Loop from its first iteration when asked to rerun a node inside it', async () => {
    const source = await startSource(LOOP_WORKFLOW)
    await d.report(source.id, 'implement', { summary: 'first' })
    await d.report(source.id, 'review', { verdict: 42 })
    await waitUntil(() => h.db.getWorkflowRun(source.id)?.state === 'failed')
    await engine.whenControllerSettled(source.id)

    const rerun = await startRerun(deps(), { runId: source.id, fromNodeId: 'review' })

    expect(rerun.rerunFromNodeId).toBe('qa')
    await d.reached(rerun.id, 'implement', 'running')
    expect(attemptsOf(rerun.id, 'start')[0]?.state).toBe('completed')
    expect(attemptsOf(rerun.id, 'implement')).toHaveLength(1)
    expect(attemptsOf(rerun.id, 'implement')[0]?.iteration).toBe(0)
    expect(attemptsOf(rerun.id, 'review')).toEqual([])
    const copied = h.db.listWorkflowEventsOfKind(rerun.id, 'attempt_copied')
    expect(copied.map((event) => readPath(event.payloadJson, ['nodeId']))).toEqual(['start'])
  })

  it('refuses planner runs, runs that did not fail, unknown nodes and a busy workspace', async () => {
    const source = await failAtThirdNode()
    const planner = h.db.createWorkflowRun({
      workflowName: 'planner',
      workflowSource: 'project',
      workflowSnapshot: THREE_NODE_WORKFLOW,
      workflowVersion: DRAFT_PLANNER_RUN_VERSION,
      objective: 'plan',
      repoId: repo.id,
      worktreeId: 'repo::planner'
    })
    h.db.transitionWorkflowRun(planner.id, 'failed')
    await expect(startRerun(deps(), { runId: planner.id })).rejects.toMatchObject({
      code: 'workflow_rerun_refused'
    })
    const running = await startSource()
    await expect(startRerun(deps(), { runId: running.id })).rejects.toMatchObject({
      code: 'workflow_rerun_refused'
    })
    await expect(startRerun(deps(), { runId: source.id, fromNodeId: 'missing' })).rejects.toThrow(
      /no node missing/
    )
    // `running` is live in the same run workspace, so a rerun there would share it.
    await expect(startRerun(deps(), { runId: source.id })).rejects.toMatchObject({
      code: 'workflow_rerun_refused',
      message: expect.stringContaining(running.id)
    })
    await expect(startRerun(deps(), { runId: 'wfr_missing' })).rejects.toThrow('workflow_not_found')
    expect(h.db.listWorkflowRuns({}).runs.every((run) => !run.rerunOfRunId)).toBe(true)
  })

  it('starts exactly one of two overlapping reruns in the same run workspace', async () => {
    const source = await failAtThirdNode()

    const results = await Promise.allSettled([
      startRerun(deps(), { runId: source.id }),
      startRerun(deps(), { runId: source.id })
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((result) => result.status === 'rejected')
    expect(refused?.status === 'rejected' && refused.reason).toMatchObject({
      code: 'workflow_rerun_refused'
    })
    expect(h.db.listWorkflowRuns({}).runs.filter((run) => run.rerunOfRunId)).toHaveLength(1)
  })

  it('refuses while the source run still has a worker that may be alive', async () => {
    const source = await failAtThirdNode()
    const stranded = h.db.createWorkflowAttempt({
      runId: source.id,
      nodeId: 'review',
      nodeType: 'agent'
    })
    for (const state of ['provisioning', 'running', 'unverifiable'] as const) {
      h.db.transitionWorkflowAttempt(stranded.id, state)
    }

    await expect(startRerun(deps(), { runId: source.id })).rejects.toMatchObject({
      code: 'workflow_rerun_refused',
      message: expect.stringContaining('may still be running')
    })
    expect(h.db.listWorkflowRuns({}).runs.every((run) => !run.rerunOfRunId)).toBe(true)
  })

  it('refuses when the source run workspace is gone', async () => {
    const source = await failAtThirdNode()
    vi.spyOn(h.runtime, 'showManagedWorktree').mockRejectedValue(new Error('worktree_not_found'))
    await expect(startRerun(deps(), { runId: source.id })).rejects.toMatchObject({
      code: 'workflow_rerun_workspace_unavailable'
    })
  })
})
