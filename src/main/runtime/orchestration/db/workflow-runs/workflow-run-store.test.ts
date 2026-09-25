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

describe('workflow-run-store', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => db?.close())

  function createDb(): OrchestrationDb {
    db = new OrchestrationDb(':memory:')
    return db
  }

  it('creates a run with defaults and round-trips the full snapshot', () => {
    const d = createDb()
    const run = d.createWorkflowRun({
      workflowName: 'demo',
      workflowSource: 'project',
      workflowSnapshot: fixtureSnapshot(),
      workflowVersion: 'v1',
      objective: 'build the thing',
      repoId: 'repo_1',
      worktreeId: 'wt_1'
    })
    expect(run.id).toMatch(/^wfr_/)
    expect(run.state).toBe('queued')
    expect(run.concurrencyLimit).toBe(4)
    expect(run.workflowSnapshot).toEqual(fixtureSnapshot())
    expect(run.startedAt).toBeUndefined()
    expect(run.finishedAt).toBeUndefined()

    const fetched = d.getWorkflowRun(run.id)
    expect(fetched).toEqual(run)
  })

  it('honors an explicit concurrency limit and optional fields', () => {
    const d = createDb()
    const run = d.createWorkflowRun({
      workflowName: 'demo',
      workflowSource: 'personal',
      workflowSnapshot: fixtureSnapshot(),
      workflowVersion: 'v1',
      objective: 'build',
      repoId: 'repo_1',
      worktreeId: 'wt_1',
      concurrencyLimit: 8,
      startedByClient: 'cli',
      rerunOfRunId: 'wfr_prior',
      rerunFromNodeId: 'node_a'
    })
    expect(run.concurrencyLimit).toBe(8)
    expect(run.startedByClient).toBe('cli')
    expect(run.rerunOfRunId).toBe('wfr_prior')
    expect(run.rerunFromNodeId).toBe('node_a')
  })

  it('returns undefined for a missing run', () => {
    const d = createDb()
    expect(d.getWorkflowRun('wfr_missing')).toBeUndefined()
  })

  describe('transitionWorkflowRun', () => {
    it('enforces canTransition and rejects an illegal jump', () => {
      const d = createDb()
      const run = d.createWorkflowRun({
        workflowName: 'demo',
        workflowSource: 'project',
        workflowSnapshot: fixtureSnapshot(),
        workflowVersion: 'v1',
        objective: 'build',
        repoId: 'repo_1',
        worktreeId: 'wt_1'
      })
      expect(() => d.transitionWorkflowRun(run.id, 'completed')).toThrow(
        /cannot transition from queued to completed/
      )
    })

    it('stamps startedAt entering running and finishedAt entering a terminal state', () => {
      const d = createDb()
      const run = d.createWorkflowRun({
        workflowName: 'demo',
        workflowSource: 'project',
        workflowSnapshot: fixtureSnapshot(),
        workflowVersion: 'v1',
        objective: 'build',
        repoId: 'repo_1',
        worktreeId: 'wt_1'
      })
      const running = d.transitionWorkflowRun(run.id, 'running')
      expect(running?.state).toBe('running')
      expect(running?.startedAt).toBeDefined()

      const completed = d.transitionWorkflowRun(run.id, 'completed')
      expect(completed?.state).toBe('completed')
      expect(completed?.finishedAt).toBeDefined()
    })

    it('returns undefined for a missing run', () => {
      const d = createDb()
      expect(d.transitionWorkflowRun('wfr_missing', 'running')).toBeUndefined()
    })
  })

  describe('listWorkflowRuns', () => {
    it('filters by repoId, name and state, and paginates with a cursor', () => {
      const d = createDb()
      const a = d.createWorkflowRun({
        workflowName: 'alpha',
        workflowSource: 'project',
        workflowSnapshot: fixtureSnapshot(),
        workflowVersion: 'v1',
        objective: 'a',
        repoId: 'repo_1',
        worktreeId: 'wt_1'
      })
      const b = d.createWorkflowRun({
        workflowName: 'beta',
        workflowSource: 'project',
        workflowSnapshot: fixtureSnapshot(),
        workflowVersion: 'v1',
        objective: 'b',
        repoId: 'repo_1',
        worktreeId: 'wt_1'
      })
      d.createWorkflowRun({
        workflowName: 'alpha',
        workflowSource: 'project',
        workflowSnapshot: fixtureSnapshot(),
        workflowVersion: 'v1',
        objective: 'c',
        repoId: 'repo_2',
        worktreeId: 'wt_2'
      })

      const byRepo = d.listWorkflowRuns({ repoId: 'repo_1' })
      expect(byRepo.runs.map((r) => r.id).sort()).toEqual([a.id, b.id].sort())
      expect(byRepo.runs.every((r) => !('workflowSnapshot' in r))).toBe(true)

      const byName = d.listWorkflowRuns({ name: 'beta' })
      expect(byName.runs.map((r) => r.id)).toEqual([b.id])

      d.transitionWorkflowRun(a.id, 'running')
      const byState = d.listWorkflowRuns({ state: 'running' })
      expect(byState.runs.map((r) => r.id)).toEqual([a.id])

      const page1 = d.listWorkflowRuns({ limit: 1 })
      expect(page1.runs).toHaveLength(1)
      expect(page1.nextCursor).not.toBeNull()

      const page2 = d.listWorkflowRuns({ limit: 1, cursor: page1.nextCursor ?? undefined })
      expect(page2.runs).toHaveLength(1)
      expect(page2.runs[0]?.id).not.toBe(page1.runs[0]?.id)
    })
  })

  describe('listActiveWorkflowRuns', () => {
    it('returns only non-terminal runs', () => {
      const d = createDb()
      const active = d.createWorkflowRun({
        workflowName: 'demo',
        workflowSource: 'project',
        workflowSnapshot: fixtureSnapshot(),
        workflowVersion: 'v1',
        objective: 'a',
        repoId: 'repo_1',
        worktreeId: 'wt_1'
      })
      const done = d.createWorkflowRun({
        workflowName: 'demo',
        workflowSource: 'project',
        workflowSnapshot: fixtureSnapshot(),
        workflowVersion: 'v1',
        objective: 'b',
        repoId: 'repo_1',
        worktreeId: 'wt_1'
      })
      d.transitionWorkflowRun(done.id, 'running')
      d.transitionWorkflowRun(done.id, 'completed')

      const activeIds = d.listActiveWorkflowRuns().map((r) => r.id)
      expect(activeIds).toContain(active.id)
      expect(activeIds).not.toContain(done.id)
    })
  })
})
