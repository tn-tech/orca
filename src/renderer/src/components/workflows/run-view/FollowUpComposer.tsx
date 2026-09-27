import React, { useId, useState } from 'react'
import { Loader2, Send, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import {
  workflowRunSendMessage,
  type RuntimeWorkflowSettings
} from '@/runtime/runtime-workflow-client'
import type {
  RunMessageView,
  WorkflowMessageMode,
  WorkflowMessageState
} from '../../../../../shared/workflows/workflow-run-types'
import { InspectorField } from '../editor/InspectorField'

export type FollowUpComposerProps = {
  runId: string
  attemptId: string
  /** This attempt's follow-ups, oldest first, each showing its current delivery state (FR-036a). */
  messages: readonly RunMessageView[]
  settings: RuntimeWorkflowSettings
}

function messageStateLabel(state: WorkflowMessageState): string {
  switch (state) {
    case 'queued':
      return translate(
        'auto.components.workflows.run-view.FollowUpComposer.stateQueued',
        'Undelivered'
      )
    case 'delivered':
      return translate(
        'auto.components.workflows.run-view.FollowUpComposer.stateDelivered',
        'Delivered'
      )
    case 'failed':
      return translate('auto.components.workflows.run-view.FollowUpComposer.stateFailed', 'Failed')
  }
}

function messageModeLabel(mode: WorkflowMessageMode): string {
  return mode === 'interrupt'
    ? translate('auto.components.workflows.run-view.FollowUpComposer.modeInterrupt', 'Interrupt')
    : translate('auto.components.workflows.run-view.FollowUpComposer.modeQueued', 'Queued')
}

function MessageRow({ message }: { message: RunMessageView }): React.JSX.Element {
  return (
    <li className="space-y-0.5 rounded-md border border-border p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{message.sender}</span>
        <span className="text-muted-foreground">{messageModeLabel(message.mode)}</span>
      </div>
      <p className="text-foreground">{message.text}</p>
      <p className="text-[11px] text-muted-foreground">
        {translate(
          'auto.components.workflows.run-view.FollowUpComposer.sentAt',
          'Sent {{when}} · {{state}}',
          {
            when: new Date(message.createdAt).toLocaleString(),
            state: messageStateLabel(message.state)
          }
        )}
      </p>
    </li>
  )
}

/**
 * FR-036/FR-036a: a follow-up message to a running node's agent, queued by default (delivered at
 * the agent's next checkpoint with a best-effort nudge) or sent immediately via the explicit
 * "Interrupt now" action. Both kinds go through `workflow.run.sendMessage` and are recorded on the
 * node attempt (`RunMessageView`) with sender, time and delivery mode, shown below with their
 * current delivery state.
 */
export default function FollowUpComposer({
  runId,
  attemptId,
  messages,
  settings
}: FollowUpComposerProps): React.JSX.Element {
  const textareaId = useId()
  const [text, setText] = useState('')
  const [sending, setSending] = useState<WorkflowMessageMode | undefined>()
  const [error, setError] = useState<string | undefined>()

  async function send(mode: WorkflowMessageMode): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }
    setSending(mode)
    setError(undefined)
    try {
      await workflowRunSendMessage(settings, { runId, attemptId, text: trimmed, mode })
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(undefined)
    }
  }

  return (
    <InspectorField
      htmlFor={textareaId}
      label={translate(
        'auto.components.workflows.run-view.FollowUpComposer.label',
        'Send a follow-up'
      )}
    >
      <Textarea
        id={textareaId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={translate(
          'auto.components.workflows.run-view.FollowUpComposer.placeholder',
          'Message the running agent…'
        )}
        className="min-h-16"
        disabled={sending !== undefined}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={sending !== undefined || text.trim().length === 0}
          onClick={() => void send('queued')}
        >
          {sending === 'queued' ? <Loader2 className="animate-spin" /> : <Send />}
          {translate('auto.components.workflows.run-view.FollowUpComposer.send', 'Send')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={sending !== undefined || text.trim().length === 0}
          onClick={() => void send('interrupt')}
        >
          {sending === 'interrupt' ? <Loader2 className="animate-spin" /> : <Zap />}
          {translate(
            'auto.components.workflows.run-view.FollowUpComposer.interruptNow',
            'Interrupt now'
          )}
        </Button>
      </div>
      {messages.length > 0 ? (
        <ul className="space-y-1.5">
          {messages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
        </ul>
      ) : null}
    </InspectorField>
  )
}
