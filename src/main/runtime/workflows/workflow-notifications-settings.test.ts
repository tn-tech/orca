import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultNotificationSettings } from '../../../shared/constants'
import type { NotificationSettings } from '../../../shared/notification-settings-types'
import { OrcaRuntimeService } from '../orca-runtime'
import type { RuntimeStore } from '../runtime-store-contract'
import { flush, createHarness, registration } from '../push/push-dispatcher.test-fixture'
import { createNotificationStreamFilter } from '../rpc/methods/notification-stream-policy'
import { setRuntimeDesktopSurface, type RuntimeDesktopSurface } from '../runtime-desktop-surface'
import {
  RuntimeMobileNotificationController,
  type MobileNotificationEvent
} from '../runtime-mobile-notification-controller'
import { dispatchWorkflowAttention, type WorkflowAttention } from './workflow-notifications'

const RUN = { id: 'wfr_1', workflowName: 'ship-it', objective: 'add a greeting' }
const RAISED: WorkflowAttention = {
  kind: 'question-raised',
  run: RUN,
  question: {
    id: 'wfq_1',
    runId: RUN.id,
    attemptId: 'wfa_1',
    kind: 'approval',
    prompt: 'Approve the plan?',
    optionsJson: {},
    state: 'pending'
  }
}

function desktop(extra: Partial<RuntimeDesktopSurface> = {}) {
  const shown: { title: string; body: string }[] = []
  setRuntimeDesktopSurface({
    showNotification: (input) => {
      shown.push(input)
      return true
    },
    findWindowById: () => null,
    onIpc: () => {},
    removeIpcListener: () => {},
    ...extra
  })
  return shown
}

function capture() {
  const port = new RuntimeMobileNotificationController()
  const events: MobileNotificationEvent[] = []
  port.onDispatched((event) => events.push(event))
  return { port, events }
}

const disabled = (): NotificationSettings => ({
  ...getDefaultNotificationSettings(),
  enabled: false
})

afterEach(() => {
  setRuntimeDesktopSurface(null)
  vi.restoreAllMocks()
})

describe('workflow-attention localization', () => {
  it('asks the desktop translator for a catalog key with an English fallback', () => {
    const translate = vi.fn((key: string) => `«${key}»`)
    const shown = desktop({ translate })
    const { port, events } = capture()

    dispatchWorkflowAttention(port, RAISED)

    expect(translate).toHaveBeenCalledWith(
      'notifications.workflowAttention.approvalNeeded',
      '{{workflowName}}: Approval needed',
      { workflowName: 'ship-it' }
    )
    expect(shown[0]?.title).toBe('«notifications.workflowAttention.approvalNeeded»')
    expect(events[0]).toMatchObject({ title: '«notifications.workflowAttention.approvalNeeded»' })
  })

  it('falls back to interpolated English on a host without a translator', () => {
    desktop()
    const { port, events } = capture()
    dispatchWorkflowAttention(port, { kind: 'run-failed', run: RUN })
    expect(events[0]).toMatchObject({ title: 'ship-it: Run failed' })
  })
})

describe('workflow-attention honours the notification settings', () => {
  it('shows no desktop toast and marks the event desktop-suppressed when notifications are off', () => {
    const shown = desktop()
    const { port } = capture()

    expect(dispatchWorkflowAttention(port, RAISED, disabled())).toEqual({ delivered: false })

    expect(shown).toEqual([])
    const recorded = port.getMissedSince(0)
    expect(recorded).toEqual([expect.objectContaining({ desktopAllowed: false })])
    expect(recorded.filter(createNotificationStreamFilter())).toEqual([])
    expect(recorded.filter(createNotificationStreamFilter(true))).toHaveLength(1)
  })

  it('pushes nothing to a phone when notifications are off', async () => {
    desktop()
    const { port, events } = capture()
    dispatchWorkflowAttention(port, RAISED, disabled())
    const push = createHarness({ devices: [{ deviceId: 'a', pushRegistration: registration() }] })

    push.dispatcher.enqueue(events[0]!)
    await flush()

    expect(push.sends).toEqual([])
  })

  it.each([
    [true, 1],
    [false, 0]
  ])(
    'pushes to an only-when-away phone only while the desktop is away (away=%s)',
    async (away, sends) => {
      desktop({ isAwayForMobileNotifications: () => away })
      const { port, events } = capture()
      dispatchWorkflowAttention(port, RAISED, getDefaultNotificationSettings())
      const push = createHarness({
        devices: [
          {
            deviceId: 'a',
            pushRegistration: registration({ filter: { onlyWhenDesktopAway: true } })
          }
        ]
      })

      push.dispatcher.enqueue(events[0]!)
      await flush()

      expect(push.sends).toHaveLength(sends)
    }
  )

  it('reads the settings from the runtime store', () => {
    const shown = desktop()
    const runtime = new OrcaRuntimeService(storeWithNotifications(disabled()))
    const events: MobileNotificationEvent[] = []
    runtime.onNotificationDispatched((event) => events.push(event))

    runtime.notifyWorkflowAttention(RAISED)

    expect(shown).toEqual([])
    expect(events).toEqual([expect.objectContaining({ desktopAllowed: false })])
  })
})

/** Minimal fake: only the settings the runtime reads when it dispatches. */
function storeWithNotifications(notifications: NotificationSettings): RuntimeStore {
  return {
    getRepo: () => undefined,
    getRepos: () => [],
    addRepo: () => {},
    updateRepo: () => {
      throw new Error('updateRepo is not used by this test')
    },
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    setWorktreeMeta: () => {
      throw new Error('setWorktreeMeta is not used by this test')
    },
    removeWorktreeMeta: () => {},
    getGitHubCache: () => ({ pr: {}, issue: {} }),
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: '',
      notifications
    })
  }
}
