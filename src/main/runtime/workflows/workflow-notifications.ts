// The `workflow-attention` notification source (spec US5, research R8): a run needs a person
// (an approval, an agent question, a trust prompt) or has ended. Host-originated like
// RuntimeMobileNotificationController.dispatchPlugin: a desktop toast where the host has a
// desktop, and always the paired-client fan-out (socket stream and push).
//
// Fired once per change by its producer, after that change is persisted: the question store
// dedupes raises and escalations, and a run reaches a terminal state once, so a rehydrated
// controller never re-announces what the previous process already did.
import { isDesktopNotificationAllowed } from '../../../shared/notification-desktop-policy'
import type { NotificationSettings } from '../../../shared/notification-settings-types'
import type { RunQuestionView, RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import { getRuntimeDesktopSurface } from '../runtime-desktop-surface'
import type { MobileNotificationDispatchEvent } from '../runtime-mobile-notification-controller'

export type WorkflowAttentionRun = Pick<RunSnapshot, 'id' | 'workflowName' | 'objective'>

export type WorkflowAttention =
  | {
      kind: 'question-raised' | 'question-escalated'
      run: WorkflowAttentionRun
      question: RunQuestionView
    }
  | { kind: 'run-failed' | 'run-completed'; run: WorkflowAttentionRun }

export type WorkflowAttentionPort = {
  dispatch(event: MobileNotificationDispatchEvent): void
}

/** The desktop's translateMain when it has one; interpolated English on a Node host. */
function translate(key: string, fallback: string, values: Record<string, string>): string {
  const translated = getRuntimeDesktopSurface().translate?.(key, fallback, values) ?? fallback
  return translated.replace(/\{\{(\w+)\}\}/g, (match, name: string) => values[name] ?? match)
}

function titleFor(attention: WorkflowAttention): string {
  const values = { workflowName: attention.run.workflowName }
  switch (attention.kind) {
    case 'run-failed':
      return translate(
        'notifications.workflowAttention.runFailed',
        '{{workflowName}}: Run failed',
        values
      )
    case 'run-completed':
      return translate(
        'notifications.workflowAttention.runCompleted',
        '{{workflowName}}: Run completed',
        values
      )
    case 'question-raised':
    case 'question-escalated':
      return questionTitle(attention.question, attention.kind === 'question-escalated', values)
  }
}

function questionTitle(
  question: RunQuestionView,
  escalated: boolean,
  values: Record<string, string>
): string {
  switch (question.kind) {
    case 'approval':
      return escalated
        ? translate(
            'notifications.workflowAttention.approvalOverdue',
            '{{workflowName}}: Approval overdue',
            values
          )
        : translate(
            'notifications.workflowAttention.approvalNeeded',
            '{{workflowName}}: Approval needed',
            values
          )
    case 'agent-question':
      return escalated
        ? translate(
            'notifications.workflowAttention.agentQuestionOverdue',
            '{{workflowName}}: Agent question overdue',
            values
          )
        : translate(
            'notifications.workflowAttention.agentQuestion',
            '{{workflowName}}: Agent question',
            values
          )
    case 'trust':
      // Trust questions have no deadline, so they are never escalated.
      return translate(
        'notifications.workflowAttention.trustNeeded',
        '{{workflowName}}: Trust needed',
        values
      )
  }
}

/**
 * `settings` are the user's notification settings, applied as the renderer-dispatched sources
 * apply them (notification-delivery-service.ts): off means no toast and no push.
 */
export function dispatchWorkflowAttention(
  port: WorkflowAttentionPort,
  attention: WorkflowAttention,
  settings?: NotificationSettings
): { delivered: boolean } {
  const title = titleFor(attention)
  const body = 'question' in attention ? attention.question.prompt : attention.run.objective
  const desktopAllowed = settings
    ? isDesktopNotificationAllowed(settings, 'workflow-attention')
    : true
  let delivered = false
  if (desktopAllowed) {
    try {
      delivered = getRuntimeDesktopSurface().showNotification({ title, body })
    } catch {
      // Headless runtimes still relay the notification to mobile clients.
    }
  }
  port.dispatch({
    type: 'notification',
    source: 'workflow-attention',
    ...(desktopAllowed ? {} : { desktopAllowed: false }),
    title,
    body,
    // Why no worktreeId: a phone routes a tap on it to a terminal session, and an in-place
    // run's worktreeId is its repo id, so the notification opens the host instead.
    notificationId: [
      'workflow',
      attention.run.id,
      'question' in attention ? attention.question.id : '',
      attention.kind
    ]
      .filter(Boolean)
      .join(':')
  })
  return { delivered }
}
