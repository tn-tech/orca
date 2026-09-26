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

describe('workflow-message-store', () => {
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

  it('creates a queued message', () => {
    const d = createDb()
    const run = createRun(d)
    const message = d.createWorkflowMessage({
      runId: run.id,
      attemptId: 'wfa_1',
      sender: 'user_1',
      text: 'please wrap up',
      mode: 'queued'
    })
    expect(message.state).toBe('queued')
    expect(message.mode).toBe('queued')
    expect(message.deliveredAt).toBeUndefined()
  })

  it('rejects a message for a missing run', () => {
    const d = createDb()
    expect(() =>
      d.createWorkflowMessage({
        runId: 'wfr_missing',
        attemptId: 'wfa_1',
        sender: 'user_1',
        text: 'x',
        mode: 'interrupt'
      })
    ).toThrow(/not found/)
  })

  it('lists pending (queued) messages, optionally scoped to a run', () => {
    const d = createDb()
    const runA = createRun(d)
    const runB = createRun(d)
    const ma = d.createWorkflowMessage({
      runId: runA.id,
      attemptId: 'wfa_1',
      sender: 'user_1',
      text: 'a',
      mode: 'queued'
    })
    d.createWorkflowMessage({
      runId: runB.id,
      attemptId: 'wfa_2',
      sender: 'user_1',
      text: 'b',
      mode: 'queued'
    })

    expect(d.listPendingWorkflowMessages(runA.id).map((m) => m.id)).toEqual([ma.id])
    expect(d.listPendingWorkflowMessages().length).toBe(2)
  })

  it('lists every message for a run regardless of state', () => {
    const d = createDb()
    const run = createRun(d)
    const queued = d.createWorkflowMessage({
      runId: run.id,
      attemptId: 'wfa_1',
      sender: 'user_1',
      text: 'a',
      mode: 'queued'
    })
    const delivered = d.createWorkflowMessage({
      runId: run.id,
      attemptId: 'wfa_2',
      sender: 'user_1',
      text: 'b',
      mode: 'queued'
    })
    d.deliverWorkflowMessage(delivered.id)

    expect(d.listWorkflowMessages(run.id).map((m) => m.id)).toEqual([queued.id, delivered.id])
  })

  it('delivers a queued message and excludes it from the pending list', () => {
    const d = createDb()
    const run = createRun(d)
    const message = d.createWorkflowMessage({
      runId: run.id,
      attemptId: 'wfa_1',
      sender: 'user_1',
      text: 'a',
      mode: 'queued'
    })
    const delivered = d.deliverWorkflowMessage(message.id)
    expect(delivered?.state).toBe('delivered')
    expect(delivered?.deliveredAt).toBeDefined()
    expect(d.listPendingWorkflowMessages(run.id)).toHaveLength(0)
  })

  it('fails a queued message', () => {
    const d = createDb()
    const run = createRun(d)
    const message = d.createWorkflowMessage({
      runId: run.id,
      attemptId: 'wfa_1',
      sender: 'user_1',
      text: 'a',
      mode: 'queued'
    })
    const failed = d.failWorkflowMessage(message.id)
    expect(failed?.state).toBe('failed')
  })

  it('does not re-deliver an already-settled message', () => {
    const d = createDb()
    const run = createRun(d)
    const message = d.createWorkflowMessage({
      runId: run.id,
      attemptId: 'wfa_1',
      sender: 'user_1',
      text: 'a',
      mode: 'queued'
    })
    d.failWorkflowMessage(message.id)
    const second = d.deliverWorkflowMessage(message.id)
    expect(second?.state).toBe('failed')
  })
})
