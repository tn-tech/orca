import { describe, expect, it } from 'vitest'
import { admitWorkflowRunChangedEvent } from './runtime-client-events'

describe('admitWorkflowRunChangedEvent', () => {
  it('admits every known reason', () => {
    for (const reason of ['state', 'attempt', 'question', 'message'] as const) {
      expect(
        admitWorkflowRunChangedEvent({ type: 'workflowRunChanged', runId: 'run-1', reason })
      ).toEqual({ type: 'workflowRunChanged', runId: 'run-1', reason })
    }
  })

  it('degrades an unrecognized reason to state instead of rejecting the event', () => {
    // Why: Rule 4 (remote-wire-compatibility.md) — a newer host's reason arm must not sink the
    // whole event for an older client.
    expect(
      admitWorkflowRunChangedEvent({
        type: 'workflowRunChanged',
        runId: 'run-1',
        reason: 'artifact'
      })
    ).toEqual({ type: 'workflowRunChanged', runId: 'run-1', reason: 'state' })
  })

  it('rejects a missing or empty runId', () => {
    expect(admitWorkflowRunChangedEvent({ type: 'workflowRunChanged', reason: 'state' })).toBeNull()
    expect(
      admitWorkflowRunChangedEvent({ type: 'workflowRunChanged', runId: '', reason: 'state' })
    ).toBeNull()
  })

  it('rejects a value of the wrong type or shape', () => {
    expect(admitWorkflowRunChangedEvent(null)).toBeNull()
    expect(admitWorkflowRunChangedEvent('workflowRunChanged')).toBeNull()
    expect(admitWorkflowRunChangedEvent({ type: 'automationsChanged' })).toBeNull()
  })
})
