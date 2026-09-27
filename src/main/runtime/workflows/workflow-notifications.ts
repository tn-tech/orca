// The `workflow-attention` notification source (spec US5, research R8): a run needs a person
// (an approval, an agent question, a trust prompt) or has ended. Host-originated like
// RuntimeMobileNotificationController.dispatchPlugin: a desktop toast where the host has a
// desktop, and always the paired-client fan-out (socket stream and push).
//
// Fired once per change by its producer, after that change is persisted: the question store
// dedupes raises and escalations, and a run reaches a terminal state once, so a rehydrated
// controller never re-announces what the previous process already did.
import type {
  RunQuestionView,
  RunSnapshot,
  WorkflowQuestionKind
} from '../../../shared/workflows/workflow-run-types'
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

const QUESTION_LABELS: Record<WorkflowQuestionKind, { raised: string; escalated: string }> = {
  approval: { raised: 'Approval needed', escalated: 'Approval overdue' },
  'agent-question': { raised: 'Agent question', escalated: 'Agent question overdue' },
  trust: { raised: 'Trust needed', escalated: 'Trust overdue' }
}

function describeAttention(attention: WorkflowAttention): {
  label: string
  body: string
  subject: string
} {
  switch (attention.kind) {
    case 'question-raised':
    case 'question-escalated': {
      const labels = QUESTION_LABELS[attention.question.kind]
      return {
        label: attention.kind === 'question-raised' ? labels.raised : labels.escalated,
        body: attention.question.prompt,
        subject: attention.question.id
      }
    }
    case 'run-failed':
      return { label: 'Run failed', body: attention.run.objective, subject: '' }
    case 'run-completed':
      return { label: 'Run completed', body: attention.run.objective, subject: '' }
  }
}

export function dispatchWorkflowAttention(
  port: WorkflowAttentionPort,
  attention: WorkflowAttention
): { delivered: boolean } {
  const { label, body, subject } = describeAttention(attention)
  const title = `${attention.run.workflowName}: ${label}`
  let delivered = false
  try {
    delivered = getRuntimeDesktopSurface().showNotification({ title, body })
  } catch {
    // Headless runtimes still relay the notification to mobile clients.
  }
  port.dispatch({
    type: 'notification',
    source: 'workflow-attention',
    title,
    body,
    // Why no worktreeId: a phone routes a tap on it to a terminal session, and an in-place
    // run's worktreeId is its repo id, so the notification opens the host instead.
    notificationId: ['workflow', attention.run.id, subject, attention.kind]
      .filter(Boolean)
      .join(':')
  })
  return { delivered }
}
