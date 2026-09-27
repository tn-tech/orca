// "Interrupt now" into a terminal worker through the runtime's real agent-prompt writer: only the
// PTY itself is faked, so sanitising, bracketed paste and the settled Enter are the shipped ones.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROMPT_BRACKETED_PASTE_END,
  AGENT_PROMPT_BRACKETED_PASTE_START
} from '../../../shared/agent-prompt-injection'
import { createAgentPromptSubmissionRuntime } from '../agent-prompt-submission-runtime-test-fixture'
import type { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import { AgentAnswerDeliveryBackoff } from './workflow-agent-answer-delivery'
import { deliverFollowUps, queueFollowUp } from './workflow-follow-up-delivery'
import { TWO_NODE_WORKFLOW } from './workflow-run-controller-test-harness'
import { WorkflowRunRecorder } from './workflow-run-recorder'

vi.mock('../../git/worktree', () => {
  const worktree = {
    path: '/tmp/worktree-a',
    head: 'abc',
    branch: 'feature/follow-up',
    isBare: false,
    isMainWorktree: false
  }
  return {
    listWorktrees: vi.fn().mockResolvedValue([worktree]),
    listWorktreesStrict: vi.fn().mockResolvedValue([worktree])
  }
})

describe('terminal interrupt follow-up', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    vi.useRealTimers()
    db?.close()
  })

  /** A running attempt with one queued interrupt, delivered through the real prompt writer. */
  async function interrupt(
    onWrite: Parameters<typeof createAgentPromptSubmissionRuntime>[0],
    text = 'Use postgres.',
    beforeSend: (runtime: OrcaRuntimeService) => void = () => {}
  ) {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(onWrite)
    db = new OrchestrationDb(':memory:')
    const notifier = { notifyWorkflowRunChanged: () => {} }
    const runId = db.createWorkflowRun({
      workflowName: TWO_NODE_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: TWO_NODE_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'x',
      repoId: 'repo',
      worktreeId: 'repo::run'
    }).id
    const recorder = new WorkflowRunRecorder(db, notifier, runId)
    recorder.transitionRun('running', 'run_started')
    const attemptId = recorder.createAttempt({ id: 'implement', type: 'agent' }).id
    recorder.transitionAttempt(attemptId, 'provisioning')
    recorder.transitionAttempt(attemptId, 'running')
    db.updateWorkflowAttempt(attemptId, { dispatchId: 'dispatch_1' })
    queueFollowUp(db, notifier, { runId, attemptId, text, mode: 'interrupt', sender: 'user' })
    writes.length = 0
    beforeSend(runtime)
    const liveDb = db
    const deliver = async (now: number): Promise<void> => {
      const delivery = deliverFollowUps(
        {
          db: liveDb,
          recorder,
          client: { call: vi.fn() },
          workerInput: { call: vi.fn() },
          sendTerminalPrompt: (target, prompt, progress) =>
            runtime.sendTerminalAgentPrompt(target, prompt, progress),
          resolveWorker: () => ({ kind: 'terminal', handle }),
          backoff
        },
        now
      )
      await vi.runAllTimersAsync()
      await delivery
    }
    const backoff = new AgentAnswerDeliveryBackoff()
    const state = () => liveDb.listWorkflowMessages(runId)[0]?.state
    const pastes = () =>
      writes.filter((data) => data.startsWith(AGENT_PROMPT_BRACKETED_PASTE_START))
    return { writes, deliver, state, pastes }
  }

  it('pastes sanitised multi-line text as one unit, then presses Enter once it settled', async () => {
    const { writes, deliver, state } = await interrupt((live, data) => {
      if (data === '\r') {
        live.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
      }
    }, 'Stop now.\nUse postgres \x1b[31minstead\x1b[0m.')

    await deliver(Date.now())

    const pasteIndex = writes.findIndex((data) =>
      data.startsWith(AGENT_PROMPT_BRACKETED_PASTE_START)
    )
    expect(writes[pasteIndex]).toBe(
      `${AGENT_PROMPT_BRACKETED_PASTE_START}Stop now.\nUse postgres <ESC>[31minstead<ESC>[0m.${AGENT_PROMPT_BRACKETED_PASTE_END}`
    )
    const enterIndex = writes.indexOf('\r')
    expect(enterIndex).toBeGreaterThan(pasteIndex)
    expect(writes.filter((data) => data === '\r')).toHaveLength(1)
    expect(writes.join('')).not.toContain('\x1b[31m')
    expect(state()).toBe('delivered')
  })

  it('counts a stalled prompt whose paste and Enter were written as delivered, never pasting again', async () => {
    const { deliver, state, pastes } = await interrupt((live, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END) || data === '\r') {
        live.onPtyData('pty-prompt', '\x1b[2J\x1b[H› Use postgres.', Date.now())
      }
    })

    await deliver(Date.now())
    await deliver(Date.now() + 120_000)

    expect(state()).toBe('delivered')
    expect(pastes()).toHaveLength(1)
  })

  it('fails, without pasting again, a prompt whose Enter a permission prompt held back', async () => {
    const { writes, deliver, state, pastes } = await interrupt((live, data) => {
      if (data.includes(AGENT_PROMPT_BRACKETED_PASTE_END)) {
        live.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())
      }
    })

    await deliver(Date.now())
    await deliver(Date.now() + 120_000)

    expect(pastes()).toHaveLength(1)
    expect(writes).not.toContain('\r')
    expect(state()).toBe('failed')
  })

  it('keeps it queued when a permission prompt refused it before anything was written', async () => {
    const { writes, deliver, state } = await interrupt(
      () => {},
      'Use postgres.',
      (runtime) =>
        runtime.onPtyData('pty-prompt', '\x1b]0;Codex waiting for permission\x07', Date.now())
    )

    await deliver(Date.now())

    expect(writes).toEqual([])
    expect(state()).toBe('queued')
  })
})
