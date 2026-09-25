// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  WORKFLOWS_CHANGED_EVENT,
  emitWorkflowsChangedWindowEvent,
  workflowsChangedWindowDetail
} from './workflows-changed-window-event'

describe('workflows-changed-window-event', () => {
  it('round-trips the published payload through the window event', () => {
    const received: unknown[] = []
    const listener = (event: Event) => received.push(workflowsChangedWindowDetail(event))
    window.addEventListener(WORKFLOWS_CHANGED_EVENT, listener)
    try {
      emitWorkflowsChangedWindowEvent({ runId: 'run-1', reason: 'attempt' })
      expect(received).toEqual([{ runId: 'run-1', reason: 'attempt' }])
    } finally {
      window.removeEventListener(WORKFLOWS_CHANGED_EVENT, listener)
    }
  })

  it('degrades a missing or malformed detail to an unscoped event instead of dropping it', () => {
    expect(workflowsChangedWindowDetail(new CustomEvent(WORKFLOWS_CHANGED_EVENT))).toEqual({})
    expect(
      workflowsChangedWindowDetail(
        new CustomEvent(WORKFLOWS_CHANGED_EVENT, { detail: 'not-an-object' })
      )
    ).toEqual({})
  })
})
