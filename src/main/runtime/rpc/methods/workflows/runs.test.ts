import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RpcRequest } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { OrcaRuntimeService } from '../../../orca-runtime'
import { OrchestrationDb } from '../../../orchestration/db'
import type { Repo } from '../../../../../shared/repo-types'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import type { RuntimeStore } from '../../../runtime-store-contract'
import { writeWorkflow } from '../../../workflows/workflow-file-store'
import { WORKFLOW_RUN_METHODS } from './runs'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

const TRIVIAL_WORKFLOW_YAML = [
  'version: 1',
  'name: trivial',
  'workspacePolicy: in-place',
  'roles: {}',
  'nodes:',
  '  - { id: start, type: start, title: Start }',
  '  - { id: end, type: end, title: Done }',
  'edges:',
  '  - { id: e1, from: start, to: end }',
  'layout: {}'
].join('\n')

// Structurally parseable (min 1 node) but graph-invalid: no End node, so engine.startRun's
// validateWorkflowGraph refuses it — exercises runs.ts's WorkflowGraphValidationError mapping.
const NO_END_WORKFLOW_YAML = [
  'version: 1',
  'name: no-end',
  'workspacePolicy: in-place',
  'roles: {}',
  'nodes:',
  '  - { id: start, type: start, title: Start }',
  'edges: []',
  'layout: {}'
].join('\n')

// Structurally and graph valid otherwise, but references a repository skill source no orca.yaml
// allowlists — exercises run.start's allowlist-specific refusal shape.
const NON_ALLOWLISTED_SOURCE_WORKFLOW_YAML = [
  'version: 1',
  'name: tainted',
  'workspacePolicy: in-place',
  'roles:',
  '  dev:',
  '    name: Developer',
  '    agent: claude',
  '    systemPrompt: Build it.',
  '    skills:',
  '      - name: a-skill',
  '        source: { kind: repository, location: "https://example.com/not-allowlisted" }',
  '        required: true',
  'nodes:',
  '  - { id: start, type: start, title: Start }',
  '  - id: work',
  '    type: agent',
  '    title: Work',
  '    roleId: dev',
  '    prompt: Go',
  '    workspace: run',
  '    resultContract: { type: object }',
  '    artifacts: []',
  '    question: { timeoutMs: 1000, escalationGraceMs: 1000 }',
  '  - { id: end, type: end, title: End }',
  'edges:',
  '  - { id: e1, from: start, to: work }',
  '  - { id: e2, from: work, to: end }',
  'layout: {}'
].join('\n')

function repoFixture(path: string): Repo {
  return { id: 'repo-1', path, displayName: 'Repo', badgeColor: '#000', addedAt: 0 }
}

function storeFixture(repo: Repo): RuntimeStore {
  return {
    getRepo: (id) => (id === repo.id ? repo : undefined),
    getRepos: () => [repo],
    addRepo: () => {},
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: run.start never updates the repo through this fixture; the return value is never read.
    updateRepo: () => undefined as never,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: run.start's in-place workspace never sets worktree meta through this fixture; unused otherwise.
    setWorktreeMeta: () => undefined as never,
    removeWorktreeMeta: () => {},
    getGitHubCache: () => ({ pr: {}, issue: {} }),
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    })
  }
}

describe('workflow.run.start (real engine, in-place trivial workflow)', () => {
  let repoPath: string
  let repo: Repo
  let runtime: OrcaRuntimeService
  let db: OrchestrationDb

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'orca-workflow-run-start-'))
    repo = repoFixture(repoPath)
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService(storeFixture(repo))
    runtime.setOrchestrationDb(db)
  })

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true })
    db.close()
  })

  function dispatcher(): RpcDispatcher {
    return new RpcDispatcher({ runtime, methods: WORKFLOW_RUN_METHODS })
  }

  it('starts a run for a written workflow and returns its id', async () => {
    await writeWorkflow(repo, 'project', 'trivial', TRIVIAL_WORKFLOW_YAML, null)
    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.start', { repo: repoPath, name: 'trivial', objective: 'go' })
    )
    expect(response.ok).toBe(true)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the RpcSuccess result is typed unknown on the wire; workflow.run.start's documented shape is `{ runId }`.
    const runId = response.ok ? (response.result as { runId: string }).runId : ''
    expect(runId).toMatch(/^wfr_/)
    expect(db.getWorkflowRun(runId)).toBeDefined()
  })

  it('maps a graph-invalid workflow to workflow_invalid with problems', async () => {
    await writeWorkflow(repo, 'project', 'no-end', NO_END_WORKFLOW_YAML, null)
    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.start', { repo: repoPath, name: 'no-end', objective: 'go' })
    )
    expect(response.ok).toBe(false)
    expect(response.ok || response.error.code).toBe('workflow_invalid')
    expect(response.ok || response.error.data).toMatchObject({
      problems: [expect.objectContaining({ code: 'graph_missing_end' })]
    })
  })

  it('reports workflow_not_found for a name with no workflow file', async () => {
    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.start', { repo: repoPath, name: 'missing', objective: 'go' })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_not_found' } })
  })

  it('refuses a workflow whose source is not on the repo allowlist, naming it and the allowlist', async () => {
    await writeWorkflow(repo, 'project', 'tainted', NON_ALLOWLISTED_SOURCE_WORKFLOW_YAML, null)
    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.start', { repo: repoPath, name: 'tainted', objective: 'go' })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_source_not_allowed' } })
    expect(response.ok || response.error.data).toMatchObject({
      problems: [expect.objectContaining({ code: 'graph_skill_source_not_allowlisted' })],
      allowlistPath: expect.stringContaining('orca.yaml')
    })
  })
})

describe('workflow.run.list/show/events/readNodeOutput (seeded db)', () => {
  let db: OrchestrationDb

  function fixtureSnapshot(): Workflow {
    return {
      version: 1,
      name: 'demo',
      workspacePolicy: 'run-workspace',
      roles: {},
      nodes: [],
      edges: [],
      layout: {}
    }
  }

  function seedRun(repoId = 'repo_1') {
    return db.createWorkflowRun({
      workflowName: 'demo',
      workflowSource: 'project',
      workflowSnapshot: fixtureSnapshot(),
      workflowVersion: 'v1',
      objective: 'build',
      repoId,
      worktreeId: 'wt_1'
    })
  }

  function dispatcher(): RpcDispatcher {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these handlers only call getOrchestrationDb; the rest of OrcaRuntimeService's surface is never reached.
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      getOrchestrationDb: () => db
    } as unknown as OrcaRuntimeService
    return new RpcDispatcher({ runtime, methods: WORKFLOW_RUN_METHODS })
  }

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => db.close())

  it('lists runs, optionally filtered by name and state', async () => {
    const run = seedRun()
    const response = await dispatcher().dispatch(makeRequest('workflow.run.list', {}))
    expect(response.ok).toBe(true)
    expect(response.ok && response.result).toMatchObject({ runs: [{ id: run.id }] })

    const filtered = await dispatcher().dispatch(
      makeRequest('workflow.run.list', { name: 'nonexistent' })
    )
    expect(filtered.ok && filtered.result).toMatchObject({ runs: [] })
  })

  it('shows a run with its attempts, questions, messages and events', async () => {
    const run = seedRun()
    db.createWorkflowAttempt({ runId: run.id, nodeId: 'n1', nodeType: 'agent' })
    db.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_1',
      kind: 'approval',
      prompt: 'ok?'
    })
    db.createWorkflowMessage({
      runId: run.id,
      attemptId: 'wfa_1',
      sender: 'user',
      text: 'hi',
      mode: 'queued'
    })
    db.appendWorkflowEvent({ runId: run.id, kind: 'run_started' })

    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.show', { runId: run.id })
    )
    expect(response.ok).toBe(true)
    expect(response.ok && response.result).toMatchObject({
      id: run.id,
      attempts: [expect.objectContaining({ nodeId: 'n1' })],
      questions: [expect.objectContaining({ prompt: 'ok?' })],
      messages: [expect.objectContaining({ text: 'hi' })],
      events: [expect.objectContaining({ kind: 'run_started' })]
    })
  })

  it('reports workflow_not_found showing a run that does not exist', async () => {
    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.show', { runId: 'wfr_x' })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_not_found' } })
  })

  it('pages events by afterSeq and reports the next cursor', async () => {
    const run = seedRun()
    db.appendWorkflowEvent({ runId: run.id, kind: 'a' })
    db.appendWorkflowEvent({ runId: run.id, kind: 'b' })

    const first = await dispatcher().dispatch(makeRequest('workflow.run.events', { runId: run.id }))
    expect(first.ok).toBe(true)
    const firstResult = first.ok
      ? // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the RpcSuccess result is typed unknown on the wire; workflow.run.events' documented shape is `{ events, nextSeq }`.
        (first.result as { events: { kind: string }[]; nextSeq: number })
      : undefined
    expect(firstResult?.events.map((e) => e.kind)).toEqual(['a', 'b'])

    const second = await dispatcher().dispatch(
      makeRequest('workflow.run.events', { runId: run.id, afterSeq: firstResult?.nextSeq })
    )
    expect(second.ok && second.result).toMatchObject({ events: [], nextSeq: firstResult?.nextSeq })
  })

  it('reports workflow_not_found reading events for a run that does not exist', async () => {
    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.events', { runId: 'wfr_x' })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_not_found' } })
  })

  it('reports dispatch_not_found reading node output for an attempt with no dispatch', async () => {
    const run = seedRun()
    const attempt = db.createWorkflowAttempt({ runId: run.id, nodeId: 'n1', nodeType: 'agent' })
    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.readNodeOutput', { runId: run.id, attemptId: attempt.id })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'dispatch_not_found' } })
  })

  it('reports workflow_not_found reading node output for a run that does not exist', async () => {
    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.readNodeOutput', { runId: 'wfr_x', attemptId: 'wfa_1' })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_not_found' } })
  })

  it('refuses an attempt id that belongs to a different run', async () => {
    const runA = seedRun('repo_a')
    const runB = seedRun('repo_b')
    const attemptOnA = db.createWorkflowAttempt({ runId: runA.id, nodeId: 'n1', nodeType: 'agent' })

    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.readNodeOutput', { runId: runB.id, attemptId: attemptOnA.id })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'dispatch_not_found' } })
  })
})
