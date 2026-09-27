import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOBILE_PUSH_SOURCES } from '../../../shared/mobile-push-contract'
import type { RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import { setRuntimeDesktopSurface } from '../runtime-desktop-surface'
import {
  RuntimeMobileNotificationController,
  type MobileNotificationEvent
} from '../runtime-mobile-notification-controller'
import { createNotificationStreamFilter } from '../rpc/methods/notification-stream-policy'
import { dispatchWorkflowAttention, type WorkflowAttention } from './workflow-notifications'

const RUN = { id: 'wfr_1', workflowName: 'ship-it', objective: 'add a greeting' }

function question(overrides: Partial<RunQuestionView> = {}): RunQuestionView {
  return {
    id: 'wfq_1',
    runId: RUN.id,
    attemptId: 'wfa_1',
    kind: 'approval',
    prompt: 'Approve the plan?',
    optionsJson: {},
    state: 'pending',
    ...overrides
  }
}

function desktop(showNotification: (input: { title: string; body: string }) => boolean) {
  const shown: { title: string; body: string }[] = []
  setRuntimeDesktopSurface({
    showNotification: (input) => {
      shown.push(input)
      return showNotification(input)
    },
    findWindowById: () => null,
    onIpc: () => {},
    removeIpcListener: () => {}
  })
  return shown
}

function capture(): {
  port: RuntimeMobileNotificationController
  events: MobileNotificationEvent[]
} {
  const port = new RuntimeMobileNotificationController()
  const events: MobileNotificationEvent[] = []
  port.onDispatched((event) => events.push(event))
  return { port, events }
}

describe('dispatchWorkflowAttention', () => {
  afterEach(() => {
    setRuntimeDesktopSurface(null)
    vi.restoreAllMocks()
  })

  it('shows a desktop toast and relays a workflow-attention notification to paired clients', () => {
    const shown = desktop(() => true)
    const { port, events } = capture()

    const result = dispatchWorkflowAttention(port, {
      kind: 'question-raised',
      run: RUN,
      question: question()
    })

    expect(result).toEqual({ delivered: true })
    expect(shown).toEqual([{ title: 'ship-it: Approval needed', body: 'Approve the plan?' }])
    expect(events).toEqual([
      expect.objectContaining({
        type: 'notification',
        source: 'workflow-attention',
        title: 'ship-it: Approval needed',
        body: 'Approve the plan?',
        notificationId: 'workflow:wfr_1:wfq_1:question-raised'
      })
    ])
  })

  it.each<[WorkflowAttention, string, string]>([
    [
      { kind: 'question-escalated', run: RUN, question: question() },
      'ship-it: Approval overdue',
      'Approve the plan?'
    ],
    [
      {
        kind: 'question-raised',
        run: RUN,
        question: question({ kind: 'agent-question', prompt: 'Postgres or SQLite?' })
      },
      'ship-it: Agent question',
      'Postgres or SQLite?'
    ],
    [
      {
        kind: 'question-escalated',
        run: RUN,
        question: question({ kind: 'agent-question', prompt: 'Postgres or SQLite?' })
      },
      'ship-it: Agent question overdue',
      'Postgres or SQLite?'
    ],
    [
      {
        kind: 'question-raised',
        run: RUN,
        question: question({ kind: 'trust', prompt: 'Trust plugin source "acme"?' })
      },
      'ship-it: Trust needed',
      'Trust plugin source "acme"?'
    ],
    [{ kind: 'run-failed', run: RUN }, 'ship-it: Run failed', 'add a greeting'],
    [{ kind: 'run-completed', run: RUN }, 'ship-it: Run completed', 'add a greeting']
  ])('words %o as %s', (attention, title, body) => {
    desktop(() => true)
    const { port, events } = capture()

    dispatchWorkflowAttention(port, attention)

    expect(events).toEqual([expect.objectContaining({ source: 'workflow-attention', title, body })])
  })

  it('gives each run outcome its own notification id', () => {
    desktop(() => true)
    const { port, events } = capture()

    dispatchWorkflowAttention(port, { kind: 'run-failed', run: RUN })

    expect(events[0]).toMatchObject({ notificationId: 'workflow:wfr_1:run-failed' })
  })

  it('still relays to paired clients on a headless host', () => {
    desktop(() => {
      throw new Error('no desktop')
    })
    const { port, events } = capture()

    expect(dispatchWorkflowAttention(port, { kind: 'run-failed', run: RUN })).toEqual({
      delivered: false
    })
    expect(events).toHaveLength(1)
  })

  it('reaches legacy socket subscribers and push-aware ones alike', () => {
    desktop(() => false)
    const { port } = capture()

    dispatchWorkflowAttention(port, { kind: 'question-raised', run: RUN, question: question() })

    const recorded = port.getMissedSince(0)
    expect(recorded.filter(createNotificationStreamFilter())).toHaveLength(1)
    expect(recorded.filter(createNotificationStreamFilter(true))).toHaveLength(1)
  })

  it('is a push source the gateway contract names', () => {
    expect(MOBILE_PUSH_SOURCES).toContain('workflow-attention')
  })
})
