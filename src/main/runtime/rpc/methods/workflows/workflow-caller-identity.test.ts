import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approvalQuestionOptions } from '../../../../../shared/workflows/workflow-approval-question-subject'
import type { RunQuestionView } from '../../../../../shared/workflows/workflow-run-types'
import type { RpcRequest } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { OrcaRuntimeService } from '../../../orca-runtime'
import { OrchestrationDb } from '../../../orchestration/db'
import { TWO_NODE_WORKFLOW } from '../../../workflows/workflow-run-controller-test-harness'
import { WorkflowRunRecorder } from '../../../workflows/workflow-run-recorder'
import { raiseTrustQuestion } from '../../../workflows/workflow-source-trust'
import { WORKFLOW_INTERACTION_METHODS } from './interaction'
import { WORKFLOW_TRUST_METHODS } from './trust'

// A WebSocket caller's clientId is its device bearer token (runtime-rpc-websocket-dispatch.ts).
const SECRET_TOKEN = 'dvc_tok_5f0c9a7e3b1d4e2f8a6c0b9d7e5f3a1c'
const PHONE = {
  clientId: SECRET_TOKEN,
  pairedDeviceId: 'device_phone_1',
  clientKind: 'mobile' as const
}

// Through dispatchStreaming, the entry point the WebSocket transport uses for every request.
async function viaSocket(
  dispatcher: RpcDispatcher,
  request: RpcRequest,
  options?: Parameters<RpcDispatcher['dispatchStreaming']>[2]
): Promise<{ ok?: boolean }> {
  let reply: { ok?: boolean } = {}
  await dispatcher.dispatchStreaming(request, (raw) => (reply = JSON.parse(raw)), options)
  return reply
}

let sequence = 0
function request(method: string, params: unknown): RpcRequest {
  sequence += 1
  return { id: `req-${sequence}`, authToken: 'tok', method, params }
}

describe('workflow caller identity never records the bearer credential', () => {
  let db: OrchestrationDb
  let dispatcher: RpcDispatcher
  let runId: string
  let recorder: WorkflowRunRecorder

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    dispatcher = new RpcDispatcher({
      runtime,
      methods: [...WORKFLOW_INTERACTION_METHODS, ...WORKFLOW_TRUST_METHODS]
    })
    runId = db.createWorkflowRun({
      workflowName: TWO_NODE_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: TWO_NODE_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'x',
      repoId: 'repo',
      worktreeId: 'repo::run'
    }).id
    recorder = new WorkflowRunRecorder(db, runtime, runId)
    recorder.transitionRun('running', 'run_started')
  })

  afterEach(() => db.close())

  function attempt(nodeId: string, type: 'agent' | 'approval', end: 'running' | 'waiting') {
    const created = recorder.createAttempt({ id: nodeId, type })
    const path = ['provisioning', 'running', 'waiting'] as const
    for (const state of path.slice(0, path.indexOf(end) + 1)) {
      recorder.transitionAttempt(created.id, state)
    }
    return created.id
  }

  function question(kind: 'approval' | 'agent-question'): RunQuestionView {
    return db.createWorkflowQuestion({
      runId,
      attemptId: attempt(
        kind === 'approval' ? 'gate' : 'implement',
        kind === 'approval' ? 'approval' : 'agent',
        'waiting'
      ),
      kind,
      prompt: 'Which?',
      options:
        kind === 'approval'
          ? approvalQuestionOptions({ options: ['Approve', 'Reject'] })
          : { options: ['postgres', 'sqlite'] }
    })
  }

  /** Every persisted row a client can read back through workflow.run.show / events / trust.list. */
  function everythingStored(): string {
    return JSON.stringify({
      questions: db.listWorkflowQuestions(runId),
      events: db.listWorkflowEvents(runId),
      messages: db.listWorkflowMessages(runId),
      trust: db.listSourceTrust()
    })
  }

  it('records the paired device for answers, follow-ups and trust decisions', async () => {
    const approval = question('approval')
    const agentQuestion = question('agent-question')
    const running = attempt('review', 'agent', 'running')
    const trust = raiseTrustQuestion(db, {
      runId,
      attemptId: attempt('deploy', 'agent', 'waiting'),
      question: { source: 'acme-decks', host: 'local', skills: ['deck'], agents: ['claude'] }
    }).question

    const responses = [
      await viaSocket(
        dispatcher,
        request('workflow.run.answer', { runId, questionId: approval.id, optionId: 'Approve' }),
        PHONE
      ),
      await viaSocket(
        dispatcher,
        request('workflow.run.answer', { runId, questionId: agentQuestion.id, answer: 'postgres' }),
        PHONE
      ),
      await viaSocket(
        dispatcher,
        request('workflow.run.sendMessage', { runId, attemptId: running, text: 'Add tests.' }),
        PHONE
      ),
      await viaSocket(
        dispatcher,
        request('workflow.trust.decide', { source: 'acme-decks', decision: 'trusted' }),
        PHONE
      )
    ]

    expect(responses.map((response) => response.ok)).toEqual([true, true, true, true])
    const stored = everythingStored()
    expect(stored).not.toContain(SECRET_TOKEN)
    const byId = (id: string) => db.listWorkflowQuestions(runId).find((q) => q.id === id)
    expect(byId(approval.id)?.answeredBy).toBe('device_phone_1')
    expect(byId(agentQuestion.id)?.answeredBy).toBe('device_phone_1')
    expect(byId(trust.id)?.answeredBy).toBe('device_phone_1')
    expect(db.listWorkflowMessages(runId)[0]?.sender).toBe('device_phone_1')
    expect(db.listSourceTrust()[0]?.decidedBy).toBe('device_phone_1')
  })

  it('falls back to the client kind, then to user, but never to the clientId', async () => {
    const first = question('approval')
    await viaSocket(
      dispatcher,
      request('workflow.run.answer', { runId, questionId: first.id, optionId: 'Approve' }),
      { clientId: SECRET_TOKEN, clientKind: 'mobile' }
    )
    const running = attempt('review', 'agent', 'running')
    await viaSocket(
      dispatcher,
      request('workflow.run.sendMessage', { runId, attemptId: running, text: 'Stop.' })
    )

    expect(everythingStored()).not.toContain(SECRET_TOKEN)
    expect(db.listWorkflowQuestions(runId).find((q) => q.id === first.id)?.answeredBy).toBe(
      'mobile'
    )
    expect(db.listWorkflowMessages(runId)[0]?.sender).toBe('user')
  })
})
