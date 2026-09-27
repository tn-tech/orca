import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type { RunMessageView } from '../../../shared/workflows/workflow-run-types'
import { OrchestrationDb } from '../orchestration/db'
import { AgentAnswerDeliveryBackoff } from './workflow-agent-answer-delivery'
import {
  deliverFollowUps,
  failUndeliveredFollowUps,
  followUpRequestId,
  queueFollowUp,
  type FollowUpDeliveryContext,
  type FollowUpWorker
} from './workflow-follow-up-delivery'
import type {
  WorkflowOrchestrationClient,
  WorkflowWorkerInputClient
} from './workflow-orchestration-client'
import { TWO_NODE_WORKFLOW } from './workflow-run-controller-test-harness'
import { WorkflowRunRecorder, type WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { registerWorkflowRunWaker } from './workflow-run-wake'

const NOW = 1_800_000_000_000
const LATER = NOW + 120_000

describe('workflow follow-up delivery', () => {
  let db: OrchestrationDb
  let notifier: {
    notifyWorkflowRunChanged: Mock<WorkflowRunChangeNotifier['notifyWorkflowRunChanged']>
  }
  let runId: string
  let attemptId: string
  let recorder: WorkflowRunRecorder
  let mailId: string
  let orchestrationCall: Mock<WorkflowOrchestrationClient['call']>
  let workerInputCall: Mock<WorkflowWorkerInputClient['call']>
  let sendTerminalPrompt: Mock<FollowUpDeliveryContext['sendTerminalPrompt']>
  let worker: FollowUpWorker | undefined
  let backoff: AgentAnswerDeliveryBackoff

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    notifier = {
      notifyWorkflowRunChanged: vi.fn<WorkflowRunChangeNotifier['notifyWorkflowRunChanged']>()
    }
    runId = db.createWorkflowRun({
      workflowName: TWO_NODE_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: TWO_NODE_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'x',
      repoId: 'repo',
      worktreeId: 'repo::run'
    }).id
    recorder = new WorkflowRunRecorder(db, notifier, runId)
    recorder.transitionRun('running', 'run_started')
    attemptId = runningAttempt('implement')
    db.updateWorkflowAttempt(attemptId, { dispatchId: 'dispatch_1' })
    // What orchestration.send commits: a real mailbox row the agent's `check` later marks read.
    mailId = db.insertMessage({
      from: 'workflow-engine',
      to: 'dispatch:dispatch_1',
      subject: 'Follow-up',
      body: 'x',
      type: 'status'
    }).id
    orchestrationCall = vi.fn<WorkflowOrchestrationClient['call']>(async () => ({
      message: { id: mailId }
    }))
    workerInputCall = vi.fn<WorkflowWorkerInputClient['call']>(async () => ({ ok: false }))
    sendTerminalPrompt = vi.fn<FollowUpDeliveryContext['sendTerminalPrompt']>(async () => ({
      accepted: true
    }))
    worker = { kind: 'terminal', handle: 'term_worker_1' }
    backoff = new AgentAnswerDeliveryBackoff()
  })

  afterEach(() => db.close())

  function runningAttempt(nodeId: string): string {
    const id = recorder.createAttempt({ id: nodeId, type: 'agent' }).id
    recorder.transitionAttempt(id, 'provisioning')
    recorder.transitionAttempt(id, 'running')
    return id
  }

  function ctx(): FollowUpDeliveryContext {
    return {
      db,
      recorder,
      client: { call: orchestrationCall },
      workerInput: { call: workerInputCall },
      sendTerminalPrompt,
      resolveWorker: () => worker,
      backoff
    }
  }

  function queue(mode: 'queued' | 'interrupt', text = 'Also update the changelog.') {
    return queueFollowUp(db, notifier, { runId, attemptId, text, mode, sender: 'mobile_7' })
  }

  function message(id: string): RunMessageView | undefined {
    return db.listWorkflowMessages(runId).find((candidate) => candidate.id === id)
  }

  function events(kind: string) {
    return db.listWorkflowEventsOfKind(runId, kind)
  }

  describe('queueFollowUp', () => {
    it('records the message queued with its mode and sender, announces it and wakes the run', () => {
      const wake = vi.fn()
      const unregister = registerWorkflowRunWaker(runId, wake)

      const queued = queue('queued')

      unregister()
      expect(queued).toMatchObject({
        attemptId,
        sender: 'mobile_7',
        mode: 'queued',
        state: 'queued',
        text: 'Also update the changelog.'
      })
      expect(queued.deliveredAt).toBeUndefined()
      expect(events('follow_up_queued')[0]?.payloadJson).toMatchObject({
        messageId: queued.id,
        mode: 'queued',
        sender: 'mobile_7'
      })
      expect(notifier.notifyWorkflowRunChanged).toHaveBeenLastCalledWith({
        runId,
        reason: 'message'
      })
      expect(wake).toHaveBeenCalledTimes(1)
    })

    it('stores neither the message nor its event when recording the event fails', () => {
      vi.spyOn(db, 'appendWorkflowEvent').mockImplementationOnce(() => {
        throw new Error('disk full')
      })

      expect(() => queue('queued')).toThrow('disk full')
      expect(db.listWorkflowMessages(runId)).toEqual([])
    })

    it('refuses an empty message', () => {
      expect(() => queue('queued', '   ')).toThrow(
        expect.objectContaining({ code: 'invalid_argument' })
      )
      expect(db.listWorkflowMessages(runId)).toEqual([])
    })

    it('refuses a message to a node waiting on a person rather than running', () => {
      recorder.transitionAttempt(attemptId, 'waiting')

      expect(() => queue('queued')).toThrow(expect.objectContaining({ code: 'invalid_argument' }))
    })

    it('accepts a message to a node whose worker is unverifiable', () => {
      recorder.transitionAttempt(attemptId, 'unverifiable')

      expect(queue('queued').state).toBe('queued')
    })

    it('refuses a message to a node attempt that already ended', () => {
      recorder.transitionAttempt(attemptId, 'completed')

      expect(() => queue('queued')).toThrow(expect.objectContaining({ code: 'invalid_argument' }))
    })

    it('refuses a message to an attempt this run does not have', () => {
      expect(() =>
        queueFollowUp(db, notifier, {
          runId,
          attemptId: 'wfa_missing',
          text: 'hi',
          mode: 'queued',
          sender: 'user'
        })
      ).toThrow(expect.objectContaining({ code: 'invalid_argument' }))
    })

    it('refuses a message once the run has ended', () => {
      recorder.transitionRun('cancelled', 'run_cancelled')

      expect(() => queue('queued')).toThrow(
        expect.objectContaining({ code: 'workflow_run_not_active' })
      )
    })
  })

  describe('queued mode', () => {
    it('sends to the dispatch mailbox under a request id derived from the message', async () => {
      const queued = queue('queued')

      await deliverFollowUps(ctx(), NOW)

      expect(orchestrationCall).toHaveBeenCalledTimes(1)
      expect(orchestrationCall).toHaveBeenCalledWith(
        'orchestration.send',
        expect.objectContaining({ to: 'dispatch:dispatch_1', body: 'Also update the changelog.' }),
        { requestId: followUpRequestId(queued) }
      )
      expect(events('follow_up_sent')[0]?.payloadJson).toMatchObject({
        messageId: queued.id,
        orchestrationMessageId: mailId
      })
      expect(workerInputCall).not.toHaveBeenCalled()
      expect(sendTerminalPrompt).not.toHaveBeenCalled()
    })

    it('stays queued, and is never sent again, until the agent reads it', async () => {
      const queued = queue('queued')

      await deliverFollowUps(ctx(), NOW)
      await deliverFollowUps(ctx(), LATER)

      expect(message(queued.id)?.state).toBe('queued')
      expect(orchestrationCall).toHaveBeenCalledTimes(1)
      expect(events('follow_up_delivered')).toEqual([])
    })

    it('records it delivered, with mode and sender, once the agent read it at its checkpoint', async () => {
      const queued = queue('queued')
      await deliverFollowUps(ctx(), NOW)

      db.markAsRead([mailId])
      await deliverFollowUps(ctx(), LATER)

      expect(message(queued.id)?.state).toBe('delivered')
      expect(message(queued.id)?.deliveredAt).toBeDefined()
      expect(orchestrationCall).toHaveBeenCalledTimes(1)
      expect(events('follow_up_delivered')[0]?.payloadJson).toMatchObject({
        messageId: queued.id,
        mode: 'queued',
        sender: 'mobile_7'
      })
    })

    it('does not poll the mailbox again before its backoff is due', async () => {
      const queued = queue('queued')
      await deliverFollowUps(ctx(), NOW)
      db.markAsRead([mailId])

      await deliverFollowUps(ctx(), NOW + 1)

      expect(message(queued.id)?.state).toBe('queued')
      expect(backoff.nextRetryAt()).toBeGreaterThan(NOW + 1)
    })

    it('keeps it queued when the send fails and resends under the same request id', async () => {
      const queued = queue('queued')
      orchestrationCall.mockRejectedValueOnce(new Error('dispatch_inactive'))

      await deliverFollowUps(ctx(), NOW)
      expect(message(queued.id)?.state).toBe('queued')
      expect(events('follow_up_sent')).toEqual([])
      await deliverFollowUps(ctx(), NOW + 1)
      expect(orchestrationCall).toHaveBeenCalledTimes(1)

      await deliverFollowUps(ctx(), LATER)
      expect(orchestrationCall).toHaveBeenCalledTimes(2)
      const requestIds = orchestrationCall.mock.calls.map(([, , options]) => options?.requestId)
      expect(requestIds).toEqual([followUpRequestId(queued), followUpRequestId(queued)])
      expect(events('follow_up_sent')).toHaveLength(1)
    })

    it('records a repeated failure once, and again only when the failure changes', async () => {
      queue('queued')
      orchestrationCall.mockRejectedValueOnce(new Error('dispatch_inactive'))
      orchestrationCall.mockRejectedValueOnce(new Error('dispatch_inactive'))
      orchestrationCall.mockRejectedValueOnce(new Error('runtime_timeout'))

      await deliverFollowUps(ctx(), NOW)
      await deliverFollowUps(ctx(), NOW + 60_000)
      await deliverFollowUps(ctx(), NOW + 180_000)

      expect(events('follow_up_delivery_failed').map((event) => event.payloadJson)).toEqual([
        expect.objectContaining({ error: 'dispatch_inactive' }),
        expect.objectContaining({ error: 'runtime_timeout' })
      ])
    })

    it('waits, without sending, while the attempt has no dispatch yet', async () => {
      const undispatched = runningAttempt('review')
      const queued = queueFollowUp(db, notifier, {
        runId,
        attemptId: undispatched,
        text: 'hi',
        mode: 'queued',
        sender: 'user'
      })

      await deliverFollowUps(ctx(), NOW)

      expect(orchestrationCall).not.toHaveBeenCalled()
      expect(message(queued.id)?.state).toBe('queued')
    })

    it('fails a message whose attempt ended before it could be delivered', async () => {
      const queued = queue('queued')
      recorder.transitionAttempt(attemptId, 'failed')

      await deliverFollowUps(ctx(), NOW)

      expect(orchestrationCall).not.toHaveBeenCalled()
      expect(message(queued.id)?.state).toBe('failed')
      expect(events('follow_up_undeliverable')).toHaveLength(1)
    })
  })

  describe('interrupt mode', () => {
    it('pastes into a terminal worker as an agent prompt and records it as an interrupt', async () => {
      const queued = queue('interrupt', 'Stop and use postgres instead.')

      await deliverFollowUps(ctx(), NOW)

      expect(sendTerminalPrompt).toHaveBeenCalledWith(
        'term_worker_1',
        'Stop and use postgres instead.',
        expect.objectContaining({ onPasteWritten: expect.any(Function) })
      )
      expect(orchestrationCall).not.toHaveBeenCalled()
      expect(workerInputCall).not.toHaveBeenCalled()
      expect(message(queued.id)).toMatchObject({
        state: 'delivered',
        mode: 'interrupt',
        sender: 'mobile_7'
      })
      expect(events('follow_up_delivered')[0]?.payloadJson).toMatchObject({
        mode: 'interrupt',
        sender: 'mobile_7'
      })
    })

    it('keeps it queued when the terminal refused the prompt (e.g. unreachable SSH host)', async () => {
      const queued = queue('interrupt')
      sendTerminalPrompt.mockRejectedValueOnce(new Error('terminal_not_writable'))

      await deliverFollowUps(ctx(), NOW)

      expect(message(queued.id)?.state).toBe('queued')
      expect(events('follow_up_delivery_failed')[0]?.payloadJson).toMatchObject({
        error: 'terminal_not_writable'
      })
    })

    it('counts a prompt whose paste and Enter were written as delivered, even if unobserved', async () => {
      const queued = queue('interrupt')
      sendTerminalPrompt.mockImplementationOnce(async (_handle, _prompt, progress) => {
        progress.onPasteWritten()
        progress.onSubmitWritten()
        throw new Error('agent_prompt_stalled')
      })

      await deliverFollowUps(ctx(), NOW)
      await deliverFollowUps(ctx(), LATER)

      expect(sendTerminalPrompt).toHaveBeenCalledTimes(1)
      expect(message(queued.id)?.state).toBe('delivered')
      expect(events('follow_up_delivery_failed')).toEqual([])
    })

    it('fails, without pasting again, a prompt left in the composer without its Enter', async () => {
      const queued = queue('interrupt')
      sendTerminalPrompt.mockImplementationOnce(async (_handle, _prompt, progress) => {
        progress.onPasteWritten()
        throw new Error('agent_prompt_blocked')
      })

      await deliverFollowUps(ctx(), NOW)
      await deliverFollowUps(ctx(), LATER)

      expect(sendTerminalPrompt).toHaveBeenCalledTimes(1)
      expect(message(queued.id)?.state).toBe('failed')
      expect(events('follow_up_undeliverable')[0]?.payloadJson).toMatchObject({
        reason: 'not_submitted'
      })
    })

    it('retries a prompt refused before anything was written', async () => {
      const queued = queue('interrupt')
      sendTerminalPrompt.mockRejectedValueOnce(new Error('agent_prompt_blocked'))

      await deliverFollowUps(ctx(), NOW)
      expect(message(queued.id)?.state).toBe('queued')
      await deliverFollowUps(ctx(), LATER)

      expect(sendTerminalPrompt).toHaveBeenCalledTimes(2)
      expect(message(queued.id)?.state).toBe('delivered')
    })

    it('sends a user turn to a structured worker with agentSession.send', async () => {
      worker = { kind: 'structured', sessionId: 'session_1', runtimeFence: 4 }
      workerInputCall.mockResolvedValue({
        ok: true,
        value: { submission: { dispatchState: 'accepted' } }
      })
      const queued = queue('interrupt', 'Use postgres.')

      await deliverFollowUps(ctx(), NOW)

      const body = {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'text', text: 'Use postgres.' }]
      }
      expect(workerInputCall).toHaveBeenCalledWith('agentSession.send', {
        envelope: {
          sessionId: 'session_1',
          clientOperationId: expect.stringMatching(/^\d{13}-[0-9a-f]{32}$/),
          expectedRuntimeFence: 4,
          payloadFingerprint: computeAgentSessionPayloadFingerprint({
            method: 'agentSession.send',
            sessionId: 'session_1',
            fields: { body }
          })
        },
        body
      })
      expect(sendTerminalPrompt).not.toHaveBeenCalled()
      expect(message(queued.id)).toMatchObject({ state: 'delivered', mode: 'interrupt' })
    })

    it('retries an unsettled structured send under the same operation id, so it lands once', async () => {
      worker = { kind: 'structured', sessionId: 'session_1', runtimeFence: 4 }
      workerInputCall.mockResolvedValueOnce({
        ok: true,
        value: { submission: { dispatchState: 'pending' } }
      })
      workerInputCall.mockResolvedValueOnce({
        ok: true,
        value: { submission: { dispatchState: 'accepted' } }
      })
      const queued = queue('interrupt')

      await deliverFollowUps(ctx(), NOW)
      expect(message(queued.id)?.state).toBe('queued')
      expect(events('follow_up_delivery_failed')).toEqual([])
      await deliverFollowUps(ctx(), LATER)

      expect(message(queued.id)?.state).toBe('delivered')
      const [first, second] = workerInputCall.mock.calls.map(([, params]) =>
        Reflect.get(Reflect.get(params, 'envelope') ?? {}, 'clientOperationId')
      )
      expect(first).toEqual(expect.any(String))
      expect(second).toBe(first)
    })

    it('fails a structured send the session rejected', async () => {
      worker = { kind: 'structured', sessionId: 'session_1', runtimeFence: 4 }
      workerInputCall.mockResolvedValue({
        ok: true,
        value: { submission: { dispatchState: 'rejected' } }
      })
      const queued = queue('interrupt')

      await deliverFollowUps(ctx(), NOW)

      expect(message(queued.id)?.state).toBe('failed')
    })

    it('waits, without sending, while the structured session is not attached', async () => {
      worker = { kind: 'structured', sessionId: 'session_1', runtimeFence: null }
      const queued = queue('interrupt')

      await deliverFollowUps(ctx(), NOW)

      expect(workerInputCall).not.toHaveBeenCalled()
      expect(message(queued.id)?.state).toBe('queued')
    })

    it('waits while the worker behind the dispatch cannot be resolved', async () => {
      worker = undefined
      const queued = queue('interrupt')

      await deliverFollowUps(ctx(), NOW)

      expect(sendTerminalPrompt).not.toHaveBeenCalled()
      expect(message(queued.id)?.state).toBe('queued')
    })
  })

  describe('when the attempt or run ends', () => {
    function reasons(): unknown[] {
      return events('follow_up_undeliverable').map((event) =>
        Reflect.get(Object(event.payloadJson), 'reason')
      )
    }

    it('delivers a sent follow-up the agent had already read before its attempt ended', async () => {
      const queued = queue('queued')
      await deliverFollowUps(ctx(), NOW)
      db.markAsRead([mailId])
      recorder.transitionAttempt(attemptId, 'completed')

      await deliverFollowUps(ctx(), NOW + 1)

      expect(message(queued.id)?.state).toBe('delivered')
    })

    it('fails a sent follow-up the agent never received as not_received', async () => {
      const queued = queue('queued')
      await deliverFollowUps(ctx(), NOW)
      recorder.transitionAttempt(attemptId, 'completed')

      await deliverFollowUps(ctx(), NOW + 1)

      expect(message(queued.id)?.state).toBe('failed')
      expect(reasons()).toEqual(['not_received'])
    })

    it('settles every still-queued message at run end by its final receipt check', async () => {
      const secondMail = db.insertMessage({
        from: 'workflow-engine',
        to: 'dispatch:dispatch_1',
        subject: 'Follow-up',
        body: 'second',
        type: 'status'
      }).id
      orchestrationCall.mockImplementation(async (_method, params) => ({
        message: { id: params.body === 'second' ? secondMail : mailId }
      }))
      const read = queue('queued')
      const unread = queue('queued', 'second')
      await deliverFollowUps(ctx(), NOW)
      worker = undefined
      const neverSent = queue('interrupt')
      db.markAsRead([mailId])

      failUndeliveredFollowUps(db, recorder)

      expect(message(read.id)?.state).toBe('delivered')
      expect(message(unread.id)?.state).toBe('failed')
      expect(message(neverSent.id)?.state).toBe('failed')
      expect(reasons().toSorted()).toEqual(['not_received', 'run_ended'])
    })
  })
})
