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

describe('workflow-question-store', () => {
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

  it('creates a pending question', () => {
    const d = createDb()
    const run = createRun(d)
    const question = d.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_1',
      kind: 'approval',
      prompt: 'Proceed?',
      options: ['yes', 'no'],
      timeoutAt: Date.now() + 1000
    })
    expect(question.id).toBeDefined()
    expect(question.state).toBe('pending')
    expect(question.kind).toBe('approval')
    expect(question.optionsJson).toEqual(['yes', 'no'])
    expect(question.answer).toBeUndefined()
  })

  it('rejects a question for a missing run', () => {
    const d = createDb()
    expect(() =>
      d.createWorkflowQuestion({
        runId: 'wfr_missing',
        attemptId: 'wfa_1',
        kind: 'trust',
        prompt: 'Trust this source?'
      })
    ).toThrow(/not found/)
  })

  it('lists pending questions, optionally scoped to a run', () => {
    const d = createDb()
    const runA = createRun(d)
    const runB = createRun(d)
    const qa = d.createWorkflowQuestion({
      runId: runA.id,
      attemptId: 'wfa_1',
      kind: 'agent-question',
      prompt: 'q1'
    })
    d.createWorkflowQuestion({
      runId: runB.id,
      attemptId: 'wfa_2',
      kind: 'agent-question',
      prompt: 'q2'
    })

    expect(d.listPendingWorkflowQuestions(runA.id).map((q) => q.id)).toEqual([qa.id])
    expect(d.listPendingWorkflowQuestions().length).toBe(2)
  })

  it('lists every question for a run regardless of state', () => {
    const d = createDb()
    const run = createRun(d)
    const pending = d.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_1',
      kind: 'approval',
      prompt: 'Proceed?'
    })
    const answered = d.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_2',
      kind: 'approval',
      prompt: 'Also proceed?'
    })
    d.answerWorkflowQuestion(answered.id, 'yes', 'user_1')

    expect(d.listWorkflowQuestions(run.id).map((q) => q.id)).toEqual([pending.id, answered.id])
  })

  it('answers a pending question and excludes it from the pending list', () => {
    const d = createDb()
    const run = createRun(d)
    const question = d.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_1',
      kind: 'approval',
      prompt: 'Proceed?'
    })
    const answered = d.answerWorkflowQuestion(question.id, 'yes', 'user_1')
    expect(answered?.state).toBe('answered')
    expect(answered?.answer).toBe('yes')
    expect(answered?.answeredBy).toBe('user_1')
    expect(answered?.answeredAt).toBeDefined()
    expect(d.listPendingWorkflowQuestions(run.id)).toHaveLength(0)
  })

  it('does not overwrite an already-answered question', () => {
    const d = createDb()
    const run = createRun(d)
    const question = d.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_1',
      kind: 'approval',
      prompt: 'Proceed?'
    })
    d.answerWorkflowQuestion(question.id, 'yes', 'user_1')
    const second = d.answerWorkflowQuestion(question.id, 'no', 'user_2')
    expect(second?.answer).toBe('yes')
    expect(second?.answeredBy).toBe('user_1')
  })

  it('escalates a pending question', () => {
    const d = createDb()
    const run = createRun(d)
    const question = d.createWorkflowQuestion({
      runId: run.id,
      attemptId: 'wfa_1',
      kind: 'approval',
      prompt: 'Proceed?'
    })
    const escalated = d.escalateWorkflowQuestion(question.id)
    expect(escalated?.state).toBe('escalated')
  })

  it('keeps an escalated question open: listed, answerable, and expirable', () => {
    const d = createDb()
    const run = createRun(d)
    const ask = (attemptId: string) =>
      d.createWorkflowQuestion({ runId: run.id, attemptId, kind: 'approval', prompt: 'Proceed?' })
    const answered = ask('wfa_1')
    const expired = ask('wfa_2')
    const closed = ask('wfa_3')
    d.escalateWorkflowQuestion(answered.id)
    d.escalateWorkflowQuestion(expired.id)
    d.answerWorkflowQuestion(closed.id, 'yes', 'user_1')
    expect(d.listOpenWorkflowQuestions(run.id).map((q) => q.id)).toEqual([answered.id, expired.id])

    expect(d.answerWorkflowQuestion(answered.id, 'yes', 'user_2')).toMatchObject({
      state: 'answered',
      answeredBy: 'user_2'
    })
    expect(d.expireWorkflowQuestion(expired.id)?.state).toBe('expired')
    expect(d.listOpenWorkflowQuestions(run.id)).toEqual([])
  })

  describe('expiry', () => {
    it('finds pending questions whose timeout has passed and can expire them', () => {
      const d = createDb()
      const run = createRun(d)
      const now = Date.now()
      const expired = d.createWorkflowQuestion({
        runId: run.id,
        attemptId: 'wfa_1',
        kind: 'approval',
        prompt: 'Proceed?',
        timeoutAt: now - 1000
      })
      d.createWorkflowQuestion({
        runId: run.id,
        attemptId: 'wfa_2',
        kind: 'approval',
        prompt: 'Later?',
        timeoutAt: now + 100000
      })

      const candidates = d.listExpiredWorkflowQuestions(now)
      expect(candidates.map((q) => q.id)).toEqual([expired.id])

      const result = d.expireWorkflowQuestion(expired.id)
      expect(result?.state).toBe('expired')
      expect(d.listExpiredWorkflowQuestions(now)).toHaveLength(0)
    })
  })
})
