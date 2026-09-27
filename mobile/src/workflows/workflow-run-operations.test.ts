import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import {
  answerWorkflowQuestion,
  loadWorkflowRun,
  loadWorkflowRuns
} from './workflow-run-operations'

type Sent = { method: string; params: unknown }

function fakeClient(reply: (method: string, params: unknown) => RpcResponse) {
  const sent: Sent[] = []
  const sendRequest = vi.fn(async (method: string, params?: unknown) => {
    sent.push({ method, params })
    return reply(method, params)
  })
  return { client: { sendRequest }, sent }
}

function ok(result: unknown): RpcResponse {
  return { id: 'r', ok: true, result }
}

function refused(code: string, message = code): RpcResponse {
  return { id: 'r', ok: false, error: { code, message } }
}

function summary(id: string, state: string) {
  return {
    id,
    workflowName: 'feature',
    workflowSource: 'project',
    workflowVersion: 'v1',
    objective: `objective ${id}`,
    repoId: 'repo',
    state,
    concurrencyLimit: 2,
    createdAt: '2026-09-27T10:00:00.000Z'
  }
}

const pendingApproval = {
  id: 'q-1',
  runId: 'run-waiting',
  attemptId: 'att-1',
  kind: 'approval',
  prompt: 'Approve the plan?',
  optionsJson: { approval: { options: ['Approve', 'Reject'] } },
  state: 'pending'
}

describe('loadWorkflowRuns', () => {
  it('lists runs and reads questions only for runs still in flight', async () => {
    const { client, sent } = fakeClient((method, params) => {
      if (method === 'workflow.run.list') {
        return ok({ runs: [summary('run-waiting', 'waiting'), summary('run-done', 'completed')] })
      }
      expect(params).toEqual({ runId: 'run-waiting' })
      return ok({
        ...summary('run-waiting', 'waiting'),
        questions: [pendingApproval],
        attempts: []
      })
    })

    const load = await loadWorkflowRuns(client)

    expect(sent.map((entry) => entry.method)).toEqual(['workflow.run.list', 'workflow.run.show'])
    expect(load).toMatchObject({
      kind: 'loaded',
      runs: [
        {
          run: { id: 'run-waiting', state: 'waiting' },
          questions: [{ id: 'q-1', kind: 'approval' }]
        },
        { run: { id: 'run-done', state: 'completed' }, questions: [] }
      ]
    })
  })

  it.each(['forbidden', 'method_not_found'])(
    'treats a %s list refusal as a host without workflows',
    async (code) => {
      const { client } = fakeClient(() => refused(code))
      await expect(loadWorkflowRuns(client)).resolves.toEqual({ kind: 'unsupported' })
    }
  )

  it("throws the host's message for any other refusal", async () => {
    const { client } = fakeClient(() => refused('internal_error', 'db locked'))
    await expect(loadWorkflowRuns(client)).rejects.toThrow('db locked')
  })

  it('keeps a run whose snapshot vanished between list and show, with no questions', async () => {
    const { client } = fakeClient((method) =>
      method === 'workflow.run.list'
        ? ok({ runs: [summary('run-1', 'running')] })
        : refused('workflow_not_found')
    )
    await expect(loadWorkflowRuns(client)).resolves.toMatchObject({
      kind: 'loaded',
      runs: [{ run: { id: 'run-1' }, questions: [] }]
    })
  })

  it('carries the run events tail so a client can tell a timeout from a closure', async () => {
    const expired = {
      id: 'e-1',
      runId: 'run-1',
      attemptId: 'att-1',
      kind: 'approval_expired',
      payloadJson: { questionId: 'q-1', reason: 'run_ended' },
      createdAt: '2026-09-27T10:00:00.000Z'
    }
    const { client } = fakeClient((method) =>
      method === 'workflow.run.list'
        ? ok({ runs: [summary('run-1', 'running')] })
        : ok({ ...summary('run-1', 'running'), questions: [], events: [expired] })
    )
    await expect(loadWorkflowRuns(client)).resolves.toMatchObject({
      kind: 'loaded',
      runs: [{ events: [{ id: 'e-1', kind: 'approval_expired' }] }]
    })
  })

  it.each(['forbidden', 'method_not_found'])(
    'treats a %s show refusal as a host without workflows',
    async (code) => {
      const { client } = fakeClient((method) =>
        method === 'workflow.run.list' ? ok({ runs: [summary('run-1', 'waiting')] }) : refused(code)
      )
      await expect(loadWorkflowRuns(client)).resolves.toEqual({ kind: 'unsupported' })
    }
  )

  it("throws any other show refusal rather than hiding the run's prompts", async () => {
    const { client } = fakeClient((method) =>
      method === 'workflow.run.list'
        ? ok({ runs: [summary('run-1', 'waiting')] })
        : refused('internal_error', 'db locked')
    )
    await expect(loadWorkflowRuns(client)).rejects.toThrow('db locked')
  })

  it('keeps runs and questions whose state or kind a newer host added, as unknown', async () => {
    const { client } = fakeClient((method) =>
      method === 'workflow.run.list'
        ? ok({ runs: [summary('run-1', 'hibernating')] })
        : ok({
            ...summary('run-1', 'hibernating'),
            questions: [{ ...pendingApproval, kind: 'gate', state: 'snoozed' }]
          })
    )
    const load = await loadWorkflowRuns(client)
    expect(load).toMatchObject({
      kind: 'loaded',
      runs: [{ run: { state: undefined }, questions: [{ kind: undefined, state: undefined }] }]
    })
  })
})

describe('loadWorkflowRun', () => {
  it('reads one run by id', async () => {
    const { client, sent } = fakeClient(() =>
      ok({ ...summary('run-1', 'waiting'), questions: [pendingApproval], events: [] })
    )
    await expect(loadWorkflowRun(client, 'run-1')).resolves.toMatchObject({
      kind: 'loaded',
      entry: { run: { id: 'run-1', state: 'waiting' }, questions: [{ id: 'q-1' }], events: [] }
    })
    expect(sent).toEqual([{ method: 'workflow.run.show', params: { runId: 'run-1' } }])
  })

  it('reports a run that no longer exists as missing', async () => {
    const { client } = fakeClient(() => refused('workflow_not_found'))
    await expect(loadWorkflowRun(client, 'run-1')).resolves.toEqual({ kind: 'missing' })
  })

  it.each(['forbidden', 'method_not_found'])('reports %s as unsupported', async (code) => {
    const { client } = fakeClient(() => refused(code))
    await expect(loadWorkflowRun(client, 'run-1')).resolves.toEqual({ kind: 'unsupported' })
  })

  it("throws any other refusal's message", async () => {
    const { client } = fakeClient(() => refused('internal_error', 'db locked'))
    await expect(loadWorkflowRun(client, 'run-1')).rejects.toThrow('db locked')
  })
})

describe('answerWorkflowQuestion', () => {
  const target = { runId: 'run-1', questionId: 'q-1' }

  it('answers an approval by option id without sending any identity', async () => {
    const { client, sent } = fakeClient(() => ok({ state: 'running' }))
    await expect(answerWorkflowQuestion(client, target, { optionId: 'Approve' })).resolves.toEqual({
      kind: 'answered'
    })
    expect(sent).toEqual([
      {
        method: 'workflow.run.answer',
        params: { runId: 'run-1', questionId: 'q-1', optionId: 'Approve' }
      }
    ])
  })

  it('answers an agent question with free text', async () => {
    const { client, sent } = fakeClient(() => ok({ state: 'running' }))
    await answerWorkflowQuestion(client, target, { answer: 'Use SQLite' })
    expect(sent[0]?.params).toEqual({ runId: 'run-1', questionId: 'q-1', answer: 'Use SQLite' })
  })

  it.each(['forbidden', 'method_not_found'])('reports %s as unsupported', async (code) => {
    const { client } = fakeClient(() => refused(code))
    await expect(answerWorkflowQuestion(client, target, { answer: 'x' })).resolves.toEqual({
      kind: 'unsupported'
    })
  })

  it.each(['workflow_question_not_pending', 'workflow_run_not_active'])(
    'reports %s as already settled',
    async (code) => {
      const { client } = fakeClient(() => refused(code))
      await expect(answerWorkflowQuestion(client, target, { answer: 'x' })).resolves.toEqual({
        kind: 'not-pending'
      })
    }
  )

  it("surfaces any other refusal's message, and a transport failure's", async () => {
    const refusing = fakeClient(() => refused('invalid_argument', 'Unknown option'))
    await expect(
      answerWorkflowQuestion(refusing.client, target, { optionId: 'Maybe' })
    ).resolves.toEqual({ kind: 'error', message: 'Unknown option' })
    const offline = {
      sendRequest: vi.fn(async () => {
        throw new Error('Not connected')
      })
    }
    await expect(answerWorkflowQuestion(offline, target, { answer: 'x' })).resolves.toEqual({
      kind: 'error',
      message: 'Not connected'
    })
  })
})
