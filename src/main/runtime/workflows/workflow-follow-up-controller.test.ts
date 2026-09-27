// Follow-ups end to end through a live controller: the real dispatcher carries the engine's
// orchestration.send; the harness fakes only the terminal prompt write.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentAnswerDeliveryBackoff } from './workflow-agent-answer-delivery'
import { approvalDriver } from './workflow-approval-test-fixtures'
import { deliverFollowUps, queueFollowUp } from './workflow-follow-up-delivery'
import {
  createWorkflowOrchestrationClient,
  createWorkflowWorkerInputClient
} from './workflow-orchestration-client'
import { WorkflowRunRecorder } from './workflow-run-recorder'
import { createControllerHarness, waitUntil } from './workflow-run-controller-test-harness'

describe('follow-up delivery through the run controller', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>
  let d: ReturnType<typeof approvalDriver>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-follow-up-'))
    h = createControllerHarness(workspaceRoot)
    d = approvalDriver(h)
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    h.db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  async function running() {
    const run = h.createRun()
    const controller = h.createController(run.id)
    const finished = controller.run()
    const attempt = await d.reached(run.id, 'implement', 'running')
    const dispatchId = attempt.dispatchId
    const handle = dispatchId ? h.db.getWorkerDispatch(dispatchId)?.agent_terminal_handle : null
    if (!dispatchId || !handle) {
      throw new Error('implement has no worker')
    }
    return { run, controller, finished, attempt, dispatchId, handle }
  }

  function state(runId: string, messageId: string) {
    return h.db.listWorkflowMessages(runId).find((message) => message.id === messageId)?.state
  }

  /** The harness answers worker-start prompts; a follow-up prompt gets `answer` instead. */
  function interceptFollowUpPrompt(text: string, answer: () => Promise<{ accepted: boolean }>) {
    const spy = vi.mocked(h.runtime.sendTerminalAgentPrompt)
    const workerPrompt = spy.getMockImplementation()
    const followUps: string[] = []
    spy.mockImplementation(async (handle, prompt, options) => {
      if (prompt !== text) {
        return workerPrompt!(handle, prompt, options)
      }
      followUps.push(handle)
      const { accepted } = await answer()
      return { handle, accepted, bytesWritten: accepted ? prompt.length : 0 }
    })
    return followUps
  }

  it('shows a queued follow-up delivered only once the agent read it from its mailbox', async () => {
    const { run, controller, finished, attempt, dispatchId } = await running()

    const message = queueFollowUp(h.db, h.runtime, {
      runId: run.id,
      attemptId: attempt.id,
      text: 'Also update the changelog.',
      mode: 'queued',
      sender: 'mobile_7'
    })
    await waitUntil(() => h.db.getAllMessages(`dispatch:${dispatchId}`).length === 1)
    const [mail] = h.db.getAllMessages(`dispatch:${dispatchId}`)
    expect(mail).toMatchObject({ body: 'Also update the changelog.', type: 'status', read: 0 })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(state(run.id, message.id)).toBe('queued')

    // What the agent's `orchestration check` does at its next checkpoint.
    h.db.markAsRead([mail!.id])
    await waitUntil(() => state(run.id, message.id) === 'delivered')

    expect(h.db.getAllMessages(`dispatch:${dispatchId}`)).toHaveLength(1)
    controller.stop()
    await finished
  })

  it('does not resend after a crash between the send and recording it', async () => {
    const { run, controller, finished, attempt, dispatchId } = await running()
    controller.stop()
    await finished
    const message = queueFollowUp(h.db, h.runtime, {
      runId: run.id,
      attemptId: attempt.id,
      text: 'Also update the changelog.',
      mode: 'queued',
      sender: 'user'
    })
    const recorder = new WorkflowRunRecorder(h.db, h.runtime, run.id)
    const principal = { kind: 'workflow-engine' as const, workflowRunId: run.id }
    const followUps = {
      db: h.db,
      recorder,
      client: createWorkflowOrchestrationClient({ dispatcher: h.dispatcher, principal }),
      workerInput: createWorkflowWorkerInputClient({ dispatcher: h.dispatcher, principal }),
      sendTerminalPrompt: vi.fn(),
      resolveWorker: () => undefined,
      backoff: new AgentAnswerDeliveryBackoff()
    }
    const append = h.db.appendWorkflowEvent.bind(h.db)
    const crash = vi.spyOn(h.db, 'appendWorkflowEvent').mockImplementation((event) => {
      if (event.kind === 'follow_up_sent') {
        throw new Error('process died')
      }
      return append(event)
    })
    await deliverFollowUps(followUps, Date.now())
    expect(h.db.listWorkflowEventsOfKind(run.id, 'follow_up_sent')).toEqual([])
    crash.mockRestore()

    await deliverFollowUps(followUps, Date.now() + 120_000)

    const mailbox = h.db.getAllMessages(`dispatch:${dispatchId}`)
    expect(mailbox).toHaveLength(1)
    expect(h.db.listWorkflowEventsOfKind(run.id, 'follow_up_sent')).toEqual([
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          messageId: message.id,
          orchestrationMessageId: mailbox[0]?.id
        })
      })
    ])
  })

  it('pastes an interrupt into the terminal worker as an agent prompt', async () => {
    const text = 'Stop and use postgres.'
    const followUps = interceptFollowUpPrompt(text, async () => ({ accepted: true }))
    const { run, controller, finished, attempt, handle } = await running()

    const message = queueFollowUp(h.db, h.runtime, {
      runId: run.id,
      attemptId: attempt.id,
      text,
      mode: 'interrupt',
      sender: 'user'
    })
    await waitUntil(() => state(run.id, message.id) === 'delivered')

    expect(followUps).toEqual([handle])
    expect(h.db.getAllMessages(`dispatch:${attempt.dispatchId}`)).toEqual([])
    controller.stop()
    await finished
  })

  it('fails follow-ups still queued when the run ends', async () => {
    const text = 'never lands'
    interceptFollowUpPrompt(text, async () => {
      throw new Error('terminal_not_writable')
    })
    const { run, finished, attempt } = await running()
    const message = queueFollowUp(h.db, h.runtime, {
      runId: run.id,
      attemptId: attempt.id,
      text,
      mode: 'interrupt',
      sender: 'user'
    })
    await waitUntil(() =>
      h.db.listWorkflowEvents(run.id).some((event) => event.kind === 'follow_up_delivery_failed')
    )

    await d.report(run.id, 'implement')
    await d.report(run.id, 'review', { verdict: 'ok' })
    await finished

    expect(state(run.id, message.id)).toBe('failed')
  })
})
