/**
 * notifyWorkflowRunChanged is the single publication site onto both transports
 * (local IPC notifier, remote client-event stream), mirroring notifyAutomationsChanged.
 */
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import type { RuntimeClientEvent } from '../../shared/runtime-client-events'

describe('notifyWorkflowRunChanged', () => {
  it('emits workflowRunChanged on the client-event bus', () => {
    const runtime = new OrcaRuntimeService()
    const events: RuntimeClientEvent[] = []
    const unsubscribe = runtime.onClientEvent((event) => events.push(event))

    runtime.notifyWorkflowRunChanged({ runId: 'run-1', reason: 'attempt' })

    expect(events).toEqual([{ type: 'workflowRunChanged', runId: 'run-1', reason: 'attempt' }])
    unsubscribe()
  })

  it('forwards the payload to the notifier for the local IPC path', () => {
    const runtime = new OrcaRuntimeService()
    const workflowRunChanged = vi.fn()
    runtime.setNotifier({
      worktreesChanged: vi.fn(),
      reposChanged: vi.fn(),
      activateWorktree: vi.fn(),
      createTerminal: vi.fn(),
      splitTerminal: vi.fn(),
      renameTerminal: vi.fn(),
      focusTerminal: vi.fn(),
      closeTerminal: vi.fn(),
      sleepWorktree: vi.fn(),
      terminalFitOverrideChanged: vi.fn(),
      terminalDriverChanged: vi.fn(),
      workflowRunChanged
    })

    runtime.notifyWorkflowRunChanged({ runId: 'run-2', reason: 'question' })

    expect(workflowRunChanged).toHaveBeenCalledWith({ runId: 'run-2', reason: 'question' })
  })

  it('does not throw when no notifier is attached', () => {
    const runtime = new OrcaRuntimeService()
    expect(() =>
      runtime.notifyWorkflowRunChanged({ runId: 'run-3', reason: 'message' })
    ).not.toThrow()
  })
})
