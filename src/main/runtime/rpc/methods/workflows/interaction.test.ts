import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { approvalQuestionOptions } from '../../../../../shared/workflows/workflow-approval-question-subject'
import type { RunQuestionView } from '../../../../../shared/workflows/workflow-run-types'
import type { RpcRequest } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { OrcaRuntimeService } from '../../../orca-runtime'
import { OrchestrationDb } from '../../../orchestration/db'
import { TWO_NODE_WORKFLOW } from '../../../workflows/workflow-run-controller-test-harness'
import { WorkflowRunRecorder } from '../../../workflows/workflow-run-recorder'
import { registerWorkflowRunWaker } from '../../../workflows/workflow-run-wake'
import {
  listSourceTrustDecisions,
  raiseTrustQuestion
} from '../../../workflows/workflow-source-trust'
import { WORKFLOW_INTERACTION_METHODS } from './interaction'

let sequence = 0
function request(method: string, params: unknown): RpcRequest {
  sequence += 1
  return { id: `req-${sequence}`, authToken: 'tok', method, params }
}

describe('workflow.run.answer / workflow.run.sendMessage', () => {
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let dispatcher: RpcDispatcher
  let runId: string
  let recorder: WorkflowRunRecorder
  let wake: Mock<() => void>
  let unregister: () => void

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    dispatcher = new RpcDispatcher({ runtime, methods: WORKFLOW_INTERACTION_METHODS })
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
    wake = vi.fn<() => void>()
    unregister = registerWorkflowRunWaker(runId, wake)
  })

  afterEach(() => {
    unregister()
    db.close()
  })

  /** A node attempt Waiting on a question of `kind`, as the engine leaves it. */
  function waitingOn(kind: RunQuestionView['kind'], nodeId = 'implement'): RunQuestionView {
    const attempt = recorder.createAttempt({
      id: nodeId,
      type: kind === 'approval' ? 'approval' : 'agent'
    })
    for (const state of ['provisioning', 'running', 'waiting'] as const) {
      recorder.transitionAttempt(attempt.id, state)
    }
    if (kind === 'trust') {
      return raiseTrustQuestion(db, {
        runId,
        attemptId: attempt.id,
        question: { source: 'acme-decks', host: 'ssh:devbox', skills: ['deck'], agents: ['claude'] }
      }).question
    }
    return db.createWorkflowQuestion({
      runId,
      attemptId: attempt.id,
      kind,
      prompt: kind === 'approval' ? 'Approve the plan?' : 'Which database?',
      options:
        kind === 'approval'
          ? approvalQuestionOptions({ options: ['Approve', 'Reject'] })
          : { options: ['postgres', 'sqlite'] }
    })
  }

  /** Via dispatchStreaming, the WebSocket entry point that carries the paired device identity. */
  async function asDevice(req: RpcRequest, pairedDeviceId?: string): Promise<unknown> {
    let reply: unknown
    await dispatcher.dispatchStreaming(
      req,
      (raw) => (reply = JSON.parse(raw)),
      pairedDeviceId ? { pairedDeviceId, clientKind: 'mobile' } : undefined
    )
    return reply
  }

  function answer(params: Record<string, unknown>, pairedDeviceId?: string) {
    return asDevice(request('workflow.run.answer', { runId, ...params }), pairedDeviceId)
  }

  function questionById(id: string): RunQuestionView | undefined {
    return db.listWorkflowQuestions(runId).find((question) => question.id === id)
  }

  describe('workflow.run.answer', () => {
    it('answers an approval by option, records the answering client and wakes the run', async () => {
      const question = waitingOn('approval')

      const response = await answer({ questionId: question.id, optionId: 'Approve' }, 'mobile_7')

      expect(response).toMatchObject({ ok: true, result: { state: 'running' } })
      expect(questionById(question.id)).toMatchObject({
        state: 'answered',
        answer: 'Approve',
        answeredBy: 'mobile_7'
      })
      expect(questionById(question.id)?.answeredAt).toBeDefined()
      expect(wake).toHaveBeenCalledTimes(1)
    })

    it('refuses an approval option the node does not offer', async () => {
      const question = waitingOn('approval')

      const response = await answer({ questionId: question.id, optionId: 'Maybe' })

      expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
      expect(questionById(question.id)?.state).toBe('pending')
    })

    it('lets only the first answer win across clients', async () => {
      const question = waitingOn('approval')

      await answer({ questionId: question.id, optionId: 'Approve' }, 'desktop_1')
      const second = await answer({ questionId: question.id, optionId: 'Reject' }, 'mobile_7')

      expect(second).toMatchObject({ ok: false, error: { code: 'workflow_question_not_pending' } })
      expect(questionById(question.id)).toMatchObject({
        answer: 'Approve',
        answeredBy: 'desktop_1'
      })
    })

    it('answers an agent question with free text and records who answered', async () => {
      const question = waitingOn('agent-question')

      const response = await answer({ questionId: question.id, answer: 'postgres' }, 'mobile_7')

      expect(response).toMatchObject({ ok: true, result: { state: 'running' } })
      expect(questionById(question.id)).toMatchObject({
        state: 'answered',
        answer: 'postgres',
        answeredBy: 'mobile_7'
      })
      expect(wake).toHaveBeenCalledTimes(1)
    })

    it('takes a suggested option as an agent question answer', async () => {
      const question = waitingOn('agent-question')

      await answer({ questionId: question.id, optionId: 'sqlite' })

      expect(questionById(question.id)).toMatchObject({ state: 'answered', answer: 'sqlite' })
    })

    it('records the default answerer when the caller has no client identity', async () => {
      const question = waitingOn('agent-question')

      await answer({ questionId: question.id, answer: 'postgres' })

      expect(questionById(question.id)?.answeredBy).toBe('user')
    })

    it('decides a trust question for its own host and source through the trust store', async () => {
      const question = waitingOn('trust')

      const response = await answer({ questionId: question.id, optionId: 'trusted' }, 'mobile_7')

      expect(response).toMatchObject({ ok: true })
      expect(questionById(question.id)).toMatchObject({
        state: 'answered',
        answer: 'trusted',
        answeredBy: 'mobile_7'
      })
      expect(listSourceTrustDecisions(db)).toEqual([
        expect.objectContaining({
          source: 'acme-decks',
          host: 'ssh:devbox',
          decision: 'trusted',
          decidedBy: 'mobile_7'
        })
      ])
      expect(wake).toHaveBeenCalledTimes(1)
    })

    it('refuses a trust answer that is neither trusted nor refused', async () => {
      const question = waitingOn('trust')

      const response = await answer({ questionId: question.id, answer: 'maybe' })

      expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
      expect(listSourceTrustDecisions(db)).toEqual([])
    })

    it('does not re-decide trust through an already answered trust question', async () => {
      const question = waitingOn('trust')
      await answer({ questionId: question.id, optionId: 'trusted' }, 'desktop_1')

      const second = await answer({ questionId: question.id, optionId: 'refused' }, 'mobile_7')

      expect(second).toMatchObject({ ok: false, error: { code: 'workflow_question_not_pending' } })
      expect(listSourceTrustDecisions(db)).toEqual([
        expect.objectContaining({ decision: 'trusted', decidedBy: 'desktop_1' })
      ])
    })

    it('refuses an unknown question as not pending', async () => {
      const response = await answer({ questionId: 'wfq_missing', answer: 'x' })

      expect(response).toMatchObject({
        ok: false,
        error: { code: 'workflow_question_not_pending' }
      })
    })

    it('refuses a question with neither an answer nor an option', async () => {
      const question = waitingOn('agent-question')

      const response = await answer({ questionId: question.id })

      expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    })

    it('refuses answering once the run has ended', async () => {
      const question = waitingOn('trust')
      db.transitionWorkflowRun(runId, 'cancelled')

      const response = await answer({ questionId: question.id, optionId: 'trusted' })

      expect(response).toMatchObject({ ok: false, error: { code: 'workflow_run_not_active' } })
      expect(listSourceTrustDecisions(db)).toEqual([])
    })
  })

  describe('workflow.run.sendMessage', () => {
    function running(): string {
      const attempt = recorder.createAttempt({ id: 'implement', type: 'agent' })
      recorder.transitionAttempt(attempt.id, 'provisioning')
      recorder.transitionAttempt(attempt.id, 'running')
      return attempt.id
    }

    it('records a queued follow-up from the sending client and wakes the run', async () => {
      const attemptId = running()

      const response = await asDevice(
        request('workflow.run.sendMessage', { runId, attemptId, text: 'Also add tests.' }),
        'mobile_7'
      )

      const [message] = db.listWorkflowMessages(runId)
      expect(response).toMatchObject({ ok: true, result: { messageId: message?.id } })
      expect(message).toMatchObject({
        attemptId,
        sender: 'mobile_7',
        mode: 'queued',
        state: 'queued',
        text: 'Also add tests.'
      })
      expect(wake).toHaveBeenCalledTimes(1)
    })

    it('records an interrupt as an interrupt', async () => {
      const attemptId = running()

      await dispatcher.dispatch(
        request('workflow.run.sendMessage', { runId, attemptId, text: 'Stop.', mode: 'interrupt' })
      )

      expect(db.listWorkflowMessages(runId)).toEqual([
        expect.objectContaining({ mode: 'interrupt', sender: 'user', state: 'queued' })
      ])
    })

    it('refuses a message with no text', async () => {
      const attemptId = running()

      const response = await dispatcher.dispatch(
        request('workflow.run.sendMessage', { runId, attemptId })
      )

      expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
      expect(db.listWorkflowMessages(runId)).toEqual([])
    })
  })
})
