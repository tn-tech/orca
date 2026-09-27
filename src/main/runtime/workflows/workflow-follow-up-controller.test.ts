// Follow-ups end to end through a live controller: the real dispatcher carries the engine's
// orchestration.send and terminal.send; only the PTY write itself is faked.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { approvalDriver } from './workflow-approval-test-fixtures'
import { queueFollowUp } from './workflow-follow-up-delivery'
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

  it('delivers a queued follow-up into the dispatch mailbox and marks it delivered', async () => {
    const { run, controller, finished, attempt, dispatchId } = await running()

    const message = queueFollowUp(h.db, h.runtime, {
      runId: run.id,
      attemptId: attempt.id,
      text: 'Also update the changelog.',
      mode: 'queued',
      sender: 'mobile_7'
    })
    await waitUntil(() => state(run.id, message.id) === 'delivered')

    const mail = h.db.getAllMessages(`dispatch:${dispatchId}`)
    expect(mail).toEqual([
      expect.objectContaining({ body: 'Also update the changelog.', type: 'status' })
    ])
    controller.stop()
    await finished
  })

  it('types an interrupt into the terminal worker through terminal.send', async () => {
    const sendTerminal = vi
      .spyOn(h.runtime, 'sendTerminal')
      .mockImplementation(async (handle) => ({ handle, accepted: true, bytesWritten: 10 }))
    const { run, controller, finished, attempt, handle } = await running()

    const message = queueFollowUp(h.db, h.runtime, {
      runId: run.id,
      attemptId: attempt.id,
      text: 'Stop and use postgres.',
      mode: 'interrupt',
      sender: 'user'
    })
    await waitUntil(() => state(run.id, message.id) === 'delivered')

    expect(sendTerminal).toHaveBeenCalledWith(
      handle,
      { text: 'Stop and use postgres.', enter: true, interrupt: false },
      expect.anything()
    )
    expect(h.db.getAllMessages(`dispatch:${attempt.dispatchId}`)).toEqual([])
    controller.stop()
    await finished
  })

  it('fails follow-ups still queued when the run ends', async () => {
    vi.spyOn(h.runtime, 'sendTerminal').mockImplementation(async (handle) => ({
      handle,
      accepted: false,
      bytesWritten: 0
    }))
    const { run, finished, attempt } = await running()
    const message = queueFollowUp(h.db, h.runtime, {
      runId: run.id,
      attemptId: attempt.id,
      text: 'never lands',
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
