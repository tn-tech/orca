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

describe('workflow-event-store', () => {
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

  it('appends an event with an auto-incrementing id and a JSON payload', () => {
    const d = createDb()
    const run = createRun(d)
    const event = d.appendWorkflowEvent({
      runId: run.id,
      kind: 'run.state_changed',
      payloadJson: { from: 'queued', to: 'running' }
    })
    expect(event.runId).toBe(run.id)
    expect(event.kind).toBe('run.state_changed')
    expect(event.payloadJson).toEqual({ from: 'queued', to: 'running' })
    expect(event.attemptId).toBeUndefined()
    expect(typeof event.id).toBe('string')
    expect(event.createdAt).toBeDefined()
  })

  it('defaults the payload to an empty object and accepts an attemptId', () => {
    const d = createDb()
    const run = createRun(d)
    const event = d.appendWorkflowEvent({
      runId: run.id,
      attemptId: 'wfa_1',
      kind: 'attempt.started'
    })
    expect(event.payloadJson).toEqual({})
    expect(event.attemptId).toBe('wfa_1')
  })

  it('rejects an event for a missing run', () => {
    const d = createDb()
    expect(() => d.appendWorkflowEvent({ runId: 'wfr_missing', kind: 'x' })).toThrow(/not found/)
  })

  describe('listWorkflowEvents', () => {
    it('pages events after a sequence number, ordered ascending', () => {
      const d = createDb()
      const run = createRun(d)
      const e1 = d.appendWorkflowEvent({ runId: run.id, kind: 'a' })
      const e2 = d.appendWorkflowEvent({ runId: run.id, kind: 'b' })
      const e3 = d.appendWorkflowEvent({ runId: run.id, kind: 'c' })

      const all = d.listWorkflowEvents(run.id, 0, 10)
      expect(all.map((e) => e.id)).toEqual([e1.id, e2.id, e3.id])

      const afterFirst = d.listWorkflowEvents(run.id, Number(e1.id), 10)
      expect(afterFirst.map((e) => e.id)).toEqual([e2.id, e3.id])

      const limited = d.listWorkflowEvents(run.id, 0, 1)
      expect(limited.map((e) => e.id)).toEqual([e1.id])
    })

    it('scopes to the given run', () => {
      const d = createDb()
      const runA = createRun(d)
      const runB = createRun(d)
      d.appendWorkflowEvent({ runId: runA.id, kind: 'a' })
      const eventB = d.appendWorkflowEvent({ runId: runB.id, kind: 'b' })

      expect(d.listWorkflowEvents(runB.id, 0, 10).map((e) => e.id)).toEqual([eventB.id])
    })
  })

  describe('listWorkflowEventsTail', () => {
    it('returns only the last N events, oldest first', () => {
      const d = createDb()
      const run = createRun(d)
      const events = Array.from({ length: 12 }, (_, i) =>
        d.appendWorkflowEvent({ runId: run.id, kind: `event-${i}` })
      )

      const tail = d.listWorkflowEventsTail(run.id, 5)
      expect(tail.map((e) => e.kind)).toEqual(events.slice(-5).map((e) => e.kind))
      expect(tail.map((e) => e.id)).toEqual(events.slice(-5).map((e) => e.id))
    })

    it('returns everything when there are fewer events than the limit', () => {
      const d = createDb()
      const run = createRun(d)
      const e1 = d.appendWorkflowEvent({ runId: run.id, kind: 'a' })
      const e2 = d.appendWorkflowEvent({ runId: run.id, kind: 'b' })

      expect(d.listWorkflowEventsTail(run.id, 50).map((e) => e.id)).toEqual([e1.id, e2.id])
    })
  })
})
