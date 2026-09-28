import { afterEach, describe, expect, it } from 'vitest'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { OrchestrationDb } from '../orchestration-db'

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

describe('workflow-attempt-store', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => db?.close())

  function createDb(): OrchestrationDb {
    db = new OrchestrationDb(':memory:')
    return db
  }

  function createRun(d: OrchestrationDb) {
    return d.createWorkflowRun({
      workflowName: 'demo',
      workflowSource: 'project',
      workflowSnapshot: fixtureSnapshot(),
      workflowVersion: 'v1',
      objective: 'build',
      repoId: 'repo_1',
      worktreeId: 'wt_1'
    })
  }

  it('creates an attempt with defaults', () => {
    const d = createDb()
    const run = createRun(d)
    const attempt = d.createWorkflowAttempt({
      runId: run.id,
      nodeId: 'node_a',
      nodeType: 'agent'
    })
    expect(attempt.id).toMatch(/^wfa_/)
    expect(attempt.runId).toBe(run.id)
    expect(attempt.nodeId).toBe('node_a')
    expect(attempt.nodeType).toBe('agent')
    expect(attempt.iteration).toBe(0)
    expect(attempt.attemptIndex).toBe(0)
    expect(attempt.state).toBe('pending')
    expect(attempt.artifactsJson).toEqual([])
  })

  it('rejects an attempt for a missing run', () => {
    const d = createDb()
    expect(() =>
      d.createWorkflowAttempt({ runId: 'wfr_missing', nodeId: 'node_a', nodeType: 'agent' })
    ).toThrow(/not found/)
  })

  it('records task/dispatch ids, launch receipts, and result/artifacts via updateWorkflowAttempt', () => {
    const d = createDb()
    const run = createRun(d)
    const attempt = d.createWorkflowAttempt({ runId: run.id, nodeId: 'node_a', nodeType: 'agent' })

    const withLaunch = d.updateWorkflowAttempt(attempt.id, {
      taskId: 'task_123',
      dispatchId: 'dispatch_123',
      requestedLaunch: { agent: 'claude', model: 'sonnet' },
      briefPath: 'briefs/node_a.md'
    })
    expect(withLaunch?.taskId).toBe('task_123')
    expect(withLaunch?.dispatchId).toBe('dispatch_123')
    expect(withLaunch?.requestedLaunch).toEqual({ agent: 'claude', model: 'sonnet' })
    expect(withLaunch?.briefPath).toBe('briefs/node_a.md')

    const withResult = d.updateWorkflowAttempt(attempt.id, {
      resultJson: { ok: true },
      artifactsJson: [{ path: 'out.txt', exists: true }],
      resultPath: 'results/node_a.json',
      effectiveLaunch: { agent: 'claude', model: 'sonnet', effort: 'high' },
      transcriptRef: { kind: 'dispatch', id: 'dispatch_123' },
      workspaceWorktreeId: 'wt_child'
    })
    expect(withResult?.resultJson).toEqual({ ok: true })
    expect(withResult?.artifactsJson).toEqual([{ path: 'out.txt', exists: true }])
    expect(withResult?.resultPath).toBe('results/node_a.json')
    expect(withResult?.effectiveLaunch).toEqual({
      agent: 'claude',
      model: 'sonnet',
      effort: 'high'
    })
    expect(withResult?.transcriptRef).toEqual({ kind: 'dispatch', id: 'dispatch_123' })
    expect(withResult?.workspaceWorktreeId).toBe('wt_child')
    // Earlier fields are preserved, not clobbered by the later partial update.
    expect(withResult?.taskId).toBe('task_123')
  })

  it('records a failure reason', () => {
    const d = createDb()
    const run = createRun(d)
    const attempt = d.createWorkflowAttempt({ runId: run.id, nodeId: 'node_a', nodeType: 'agent' })
    const failed = d.updateWorkflowAttempt(attempt.id, { failureReason: 'contract violation' })
    expect(failed?.failureReason).toBe('contract violation')
  })

  it('returns undefined updating a missing attempt', () => {
    const d = createDb()
    expect(d.updateWorkflowAttempt('wfa_missing', { failureReason: 'x' })).toBeUndefined()
  })

  describe('transitionWorkflowAttempt', () => {
    it('enforces canTransition and rejects an illegal jump', () => {
      const d = createDb()
      const run = createRun(d)
      const attempt = d.createWorkflowAttempt({
        runId: run.id,
        nodeId: 'node_a',
        nodeType: 'agent'
      })
      expect(() => d.transitionWorkflowAttempt(attempt.id, 'completed')).toThrow(
        /cannot transition from pending to completed/
      )
    })

    it('stamps startedAt entering running and finishedAt entering a terminal state', () => {
      const d = createDb()
      const run = createRun(d)
      const attempt = d.createWorkflowAttempt({
        runId: run.id,
        nodeId: 'node_a',
        nodeType: 'agent'
      })
      d.transitionWorkflowAttempt(attempt.id, 'provisioning')
      const running = d.transitionWorkflowAttempt(attempt.id, 'running')
      expect(running?.startedAt).toBeDefined()

      const completed = d.transitionWorkflowAttempt(attempt.id, 'completed')
      expect(completed?.state).toBe('completed')
      expect(completed?.finishedAt).toBeDefined()
    })

    it('returns undefined for a missing attempt', () => {
      const d = createDb()
      expect(d.transitionWorkflowAttempt('wfa_missing', 'running')).toBeUndefined()
    })
  })

  describe('listWorkflowAttempts / findWorkflowAttemptByTask', () => {
    it('lists attempts for a run and finds by task id', () => {
      const d = createDb()
      const run = createRun(d)
      const a = d.createWorkflowAttempt({ runId: run.id, nodeId: 'node_a', nodeType: 'agent' })
      const b = d.createWorkflowAttempt({ runId: run.id, nodeId: 'node_b', nodeType: 'router' })
      d.updateWorkflowAttempt(b.id, { taskId: 'task_b' })

      const listed = d.listWorkflowAttempts(run.id)
      expect(listed.map((x) => x.id).sort()).toEqual([a.id, b.id].sort())

      const found = d.findWorkflowAttemptByTask('task_b')
      expect(found?.id).toBe(b.id)
      expect(d.findWorkflowAttemptByTask('task_missing')).toBeUndefined()
    })
  })

  describe('copyWorkflowAttempts', () => {
    it('copies attempts into another run with their results and timing, but not their Task', () => {
      const d = createDb()
      const source = createRun(d)
      const target = createRun(d)
      const a = d.createWorkflowAttempt({ runId: source.id, nodeId: 'node_a', nodeType: 'agent' })
      d.updateWorkflowAttempt(a.id, {
        taskId: 'task_a',
        dispatchId: 'dispatch_a',
        resultPath: '.orca/workflow-runs/r/a/result.json',
        resultJson: { summary: 'ok' },
        artifactsJson: [{ path: 'notes/plan.md', exists: true }]
      })
      for (const state of ['provisioning', 'running', 'completed'] as const) {
        d.transitionWorkflowAttempt(a.id, state)
      }
      const original = d.listWorkflowAttempts(source.id)[0]

      const [pair] = d.copyWorkflowAttempts([a.id], target.id)
      const { copy } = pair

      expect(pair.sourceId).toBe(a.id)

      expect(copy.id).not.toBe(a.id)
      expect(copy).toMatchObject({
        runId: target.id,
        nodeId: 'node_a',
        state: 'completed',
        dispatchId: 'dispatch_a',
        resultPath: original.resultPath,
        resultJson: { summary: 'ok' },
        artifactsJson: [{ path: 'notes/plan.md', exists: true }],
        startedAt: original.startedAt,
        finishedAt: original.finishedAt
      })
      expect(copy.taskId).toBeUndefined()
      expect(d.listWorkflowAttempts(target.id)).toEqual([copy])
      expect(d.listWorkflowAttempts(source.id)).toEqual([original])
    })

    it('copies nothing when any source attempt is missing', () => {
      const d = createDb()
      const source = createRun(d)
      const target = createRun(d)
      const a = d.createWorkflowAttempt({ runId: source.id, nodeId: 'node_a', nodeType: 'agent' })
      expect(() => d.copyWorkflowAttempts([a.id, 'wfa_missing'], target.id)).toThrow()
      expect(d.listWorkflowAttempts(target.id)).toEqual([])
    })
  })
})
