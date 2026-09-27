import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcRequest } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { OrcaRuntimeService } from '../../../orca-runtime'
import { OrchestrationDb } from '../../../orchestration/db'
import { TWO_NODE_WORKFLOW } from '../../../workflows/workflow-run-controller-test-harness'
import { registerWorkflowRunWaker } from '../../../workflows/workflow-run-wake'
import { raiseTrustQuestion } from '../../../workflows/workflow-source-trust'
import { WORKFLOW_TRUST_METHODS } from './trust'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('workflow.trust.list / workflow.trust.decide / workflow.trust.revoke', () => {
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let dispatcher: RpcDispatcher

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    dispatcher = new RpcDispatcher({ runtime, methods: WORKFLOW_TRUST_METHODS })
  })

  afterEach(() => db.close())

  it('records a per-host decision and lists it', async () => {
    const decided = await dispatcher.dispatch(
      makeRequest('workflow.trust.decide', {
        source: 'acme-decks',
        host: 'ssh:devbox',
        decision: 'trusted'
      })
    )
    expect(decided).toMatchObject({ ok: true, result: {} })

    const listed = await dispatcher.dispatch(makeRequest('workflow.trust.list'))
    expect(listed).toMatchObject({
      ok: true,
      result: {
        decisions: [{ source: 'acme-decks', host: 'ssh:devbox', decision: 'trusted' }]
      }
    })
  })

  it('answers the pending trust question for that source and wakes its run', async () => {
    const run = db.createWorkflowRun({
      workflowName: TWO_NODE_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: TWO_NODE_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'x',
      repoId: 'repo',
      worktreeId: 'repo::run'
    })
    const question = raiseTrustQuestion(db, {
      runId: run.id,
      attemptId: 'wfa_1',
      question: { source: 'acme-decks', host: 'local', skills: ['deck-writer'], agents: ['claude'] }
    })
    const wake = vi.fn()
    const unregister = registerWorkflowRunWaker(run.id, wake)

    const response = await dispatcher.dispatch(
      makeRequest('workflow.trust.decide', { source: 'acme-decks', decision: 'refused' })
    )

    expect(response.ok).toBe(true)
    expect(db.listWorkflowQuestions(run.id)).toEqual([
      expect.objectContaining({ id: question.id, state: 'answered', answer: 'refused' })
    ])
    expect(wake).toHaveBeenCalledTimes(1)
    unregister()
  })

  it('refuses a decide call without a decision', async () => {
    const response = await dispatcher.dispatch(
      makeRequest('workflow.trust.decide', { source: 'acme-decks' })
    )
    expect(response.ok).toBe(false)
    expect(db.listSourceTrust()).toEqual([])
  })

  it('revoke forgets a decision, scoped to its own host', async () => {
    await dispatcher.dispatch(
      makeRequest('workflow.trust.decide', {
        source: 'acme-decks',
        host: 'ssh:devbox',
        decision: 'trusted'
      })
    )
    await dispatcher.dispatch(
      makeRequest('workflow.trust.decide', { source: 'acme-decks', decision: 'trusted' })
    )

    const revoked = await dispatcher.dispatch(
      makeRequest('workflow.trust.revoke', { source: 'acme-decks', host: 'ssh:devbox' })
    )

    expect(revoked).toMatchObject({ ok: true, result: {} })
    const listed = await dispatcher.dispatch(makeRequest('workflow.trust.list'))
    expect(listed).toMatchObject({
      ok: true,
      result: { decisions: [{ source: 'acme-decks', host: 'local', decision: 'trusted' }] }
    })
  })

  it('revoking an unknown source/host is a no-op', async () => {
    const response = await dispatcher.dispatch(
      makeRequest('workflow.trust.revoke', { source: 'never-decided' })
    )
    expect(response).toMatchObject({ ok: true, result: {} })
    expect(db.listSourceTrust()).toEqual([])
  })
})
