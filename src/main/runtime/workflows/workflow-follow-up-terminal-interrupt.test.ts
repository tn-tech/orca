// "Interrupt now" into a terminal worker through the runtime's real agent-prompt writer: only the
// PTY itself is faked, so sanitising, bracketed paste and the settled Enter are the shipped ones.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROMPT_BRACKETED_PASTE_END,
  AGENT_PROMPT_BRACKETED_PASTE_START
} from '../../../shared/agent-prompt-injection'
import { createAgentPromptSubmissionRuntime } from '../agent-prompt-submission-runtime-test-fixture'
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

  it('pastes sanitised multi-line text as one unit, then presses Enter once it settled', async () => {
    vi.useFakeTimers()
    const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime((live, data) => {
      if (data === '\r') {
        live.onPtyData('pty-prompt', '\x1b]0;Codex working\x07', Date.now())
      }
    })
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
    const text = 'Stop now.\nUse postgres \x1b[31minstead\x1b[0m.'
    const message = queueFollowUp(db, notifier, {
      runId,
      attemptId,
      text,
      mode: 'interrupt',
      sender: 'user'
    })
    writes.length = 0

    const delivery = deliverFollowUps({
      db,
      recorder,
      client: { call: vi.fn() },
      workerInput: { call: vi.fn() },
      sendTerminalPrompt: (target, prompt) => runtime.sendTerminalAgentPrompt(target, prompt),
      resolveWorker: () => ({ kind: 'terminal', handle }),
      backoff: new AgentAnswerDeliveryBackoff()
    })
    await vi.runAllTimersAsync()
    await delivery

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
    expect(db.listWorkflowMessages(runId)).toEqual([
      expect.objectContaining({ id: message.id, state: 'delivered', mode: 'interrupt' })
    ])
  })
})
