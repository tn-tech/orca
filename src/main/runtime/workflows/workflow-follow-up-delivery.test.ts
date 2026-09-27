import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type { RunMessageView } from '../../../shared/workflows/workflow-run-types'
import { OrchestrationDb } from '../orchestration/db'
import { AgentAnswerDeliveryBackoff } from './workflow-agent-answer-delivery'
import {
  deliverFollowUps,
  failUndeliveredFollowUps,
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

describe('workflow follow-up delivery', () => {
  let db: OrchestrationDb
  let notifier: {
    notifyWorkflowRunChanged: Mock<WorkflowRunChangeNotifier['notifyWorkflowRunChanged']>
  }
  let runId: string
  let attemptId: string
  let recorder: WorkflowRunRecorder
  let orchestrationCall: Mock<WorkflowOrchestrationClient['call']>
  let workerInputCall: Mock<WorkflowWorkerInputClient['call']>
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
    attemptId = recorder.createAttempt({ id: 'implement', type: 'agent' }).id
    recorder.transitionAttempt(attemptId, 'provisioning')
    recorder.transitionAttempt(attemptId, 'running')
    db.updateWorkflowAttempt(attemptId, { dispatchId: 'dispatch_1' })
    orchestrationCall = vi.fn<WorkflowOrchestrationClient['call']>(async () => ({
      message: { id: 'msg_1' }
    }))
    workerInputCall = vi.fn<WorkflowWorkerInputClient['call']>(async () => ({
      send: { accepted: true }
    }))
    worker = { kind: 'terminal', handle: 'term_worker_1' }
    backoff = new AgentAnswerDeliveryBackoff()
  })

  afterEach(() => db.close())

  function ctx(): FollowUpDeliveryContext {
    return {
      db,
      recorder,
      client: { call: orchestrationCall },
      workerInput: { call: workerInputCall },
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

  function eventKinds(): string[] {
    return db.listWorkflowEvents(runId).map((event) => event.kind)
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
      expect(notifier.notifyWorkflowRunChanged).toHaveBeenLastCalledWith({
        runId,
        reason: 'message'
      })
      expect(wake).toHaveBeenCalledTimes(1)
    })

    it('refuses an empty message', () => {
      expect(() => queue('queued', '   ')).toThrow(
        expect.objectContaining({ code: 'invalid_argument' })
      )
      expect(db.listWorkflowMessages(runId)).toEqual([])
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
    it('sends to the dispatch mailbox, then records it delivered with mode and sender', async () => {
      const queued = queue('queued')

      await deliverFollowUps(ctx(), NOW)

      expect(orchestrationCall).toHaveBeenCalledTimes(1)
      expect(orchestrationCall).toHaveBeenCalledWith(
        'orchestration.send',
        expect.objectContaining({ to: 'dispatch:dispatch_1', body: 'Also update the changelog.' })
      )
      expect(workerInputCall).not.toHaveBeenCalled()
      expect(message(queued.id)).toMatchObject({ state: 'delivered', mode: 'queued' })
      expect(message(queued.id)?.deliveredAt).toBeDefined()
      const delivered = db
        .listWorkflowEvents(runId)
        .find((event) => event.kind === 'follow_up_delivered')
      expect(delivered?.payloadJson).toMatchObject({
        messageId: queued.id,
        mode: 'queued',
        sender: 'mobile_7'
      })
    })

    it('keeps the message queued when the send fails, and retries once the backoff is due', async () => {
      const queued = queue('queued')
      orchestrationCall.mockRejectedValueOnce(new Error('dispatch_inactive'))

      await deliverFollowUps(ctx(), NOW)
      expect(message(queued.id)?.state).toBe('queued')
      expect(eventKinds()).toContain('follow_up_delivery_failed')

      await deliverFollowUps(ctx(), NOW + 1)
      expect(orchestrationCall).toHaveBeenCalledTimes(1)

      await deliverFollowUps(ctx(), NOW + 60_000)
      expect(orchestrationCall).toHaveBeenCalledTimes(2)
      expect(message(queued.id)?.state).toBe('delivered')
    })

    it('waits, without sending, while the attempt has no dispatch yet', async () => {
      const pendingAttempt = recorder.createAttempt({ id: 'review', type: 'agent' })
      const queued = queueFollowUp(db, notifier, {
        runId,
        attemptId: pendingAttempt.id,
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
      expect(eventKinds()).toContain('follow_up_undeliverable')
    })
  })

  describe('interrupt mode', () => {
    it('types into a terminal worker with terminal.send and records it as an interrupt', async () => {
      const queued = queue('interrupt', 'Stop and use postgres instead.')

      await deliverFollowUps(ctx(), NOW)

      expect(workerInputCall).toHaveBeenCalledWith('terminal.send', {
        terminal: 'term_worker_1',
        text: 'Stop and use postgres instead.',
        enter: true
      })
      expect(orchestrationCall).not.toHaveBeenCalled()
      expect(message(queued.id)).toMatchObject({
        state: 'delivered',
        mode: 'interrupt',
        sender: 'mobile_7'
      })
      const delivered = db
        .listWorkflowEvents(runId)
        .find((event) => event.kind === 'follow_up_delivered')
      expect(delivered?.payloadJson).toMatchObject({ mode: 'interrupt', sender: 'mobile_7' })
    })

    it('keeps it queued when the terminal did not accept the input (e.g. unreachable SSH host)', async () => {
      const queued = queue('interrupt')
      workerInputCall.mockResolvedValueOnce({ send: { accepted: false, bytesWritten: 0 } })

      await deliverFollowUps(ctx(), NOW)

      expect(message(queued.id)?.state).toBe('queued')
      expect(eventKinds()).toContain('follow_up_delivery_failed')
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
      await deliverFollowUps(ctx(), NOW + 60_000)

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

      expect(workerInputCall).not.toHaveBeenCalled()
      expect(message(queued.id)?.state).toBe('queued')
    })
  })

  it('fails every still-queued message when the run ends', () => {
    const queued = queue('queued')
    const interrupt = queue('interrupt')

    failUndeliveredFollowUps(db, recorder)

    expect(message(queued.id)?.state).toBe('failed')
    expect(message(interrupt.id)?.state).toBe('failed')
  })
})
