import React from 'react'
import { AlertCircle, CircleCheck, FileDiff, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { focusRendererTerminalHandle } from '@/components/terminal-pane/terminal-handle-links'
import { focusRuntimeOrchestrationTask } from '@/components/terminal-pane/terminal-orchestration-task-links'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { WorkflowRunSnapshotView } from '@/runtime/runtime-workflow-client'
import { useAppStore } from '@/store'
import { useWorktreeById } from '@/store/selectors'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../shared/workflows/workflow-node-states'
import type {
  NodeAttemptView,
  WorkflowLaunchReceipt
} from '../../../../../shared/workflows/workflow-run-types'
import { workflowNodeStatusDotClassName } from '../editor/nodes/workflow-node-run-status-style'
import { InspectorField } from '../editor/InspectorField'
import { latestNodeAttempt } from './use-workflow-run-snapshot'

export type AttemptPanelProps = {
  definition: Workflow
  snapshot: WorkflowRunSnapshotView
  nodeId: string
  /** The workflow feature's active runtime target (see `getActiveRuntimeTarget`); `null` is desktop. */
  runtimeEnvironmentId: string | null
}

/** FR-032's exact vocabulary; every `WorkflowAttemptState` gets a case. */
function attemptStateLabel(state: WorkflowAttemptState): string {
  switch (state) {
    case 'pending':
      return translate('auto.components.workflows.run-view.AttemptPanel.statePending', 'Pending')
    case 'provisioning':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.stateProvisioning',
        'Provisioning'
      )
    case 'running':
      return translate('auto.components.workflows.run-view.AttemptPanel.stateRunning', 'Running')
    case 'waiting':
      return translate('auto.components.workflows.run-view.AttemptPanel.stateWaiting', 'Waiting')
    case 'completed':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.stateCompleted',
        'Completed'
      )
    case 'failed':
      return translate('auto.components.workflows.run-view.AttemptPanel.stateFailed', 'Failed')
    case 'skipped':
      return translate('auto.components.workflows.run-view.AttemptPanel.stateSkipped', 'Skipped')
    case 'cancelled':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.stateCancelled',
        'Cancelled'
      )
    case 'unverifiable':
      return translate(
        'auto.components.workflows.run-view.AttemptPanel.stateUnverifiable',
        'Unverifiable'
      )
  }
}

function AttemptStateBadge({ state }: { state: WorkflowAttemptState }): React.JSX.Element {
  const dotClassName = workflowNodeStatusDotClassName(state)
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
      {dotClassName ? (
        <span className={cn('size-2 rounded-full', dotClassName)} aria-hidden="true" />
      ) : null}
      {attemptStateLabel(state)}
    </span>
  )
}

function LaunchSummary({
  label,
  launch
}: {
  label: string
  launch: WorkflowLaunchReceipt | undefined
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {launch ? (
        <>
          <div className="truncate text-xs text-foreground">{launch.agent}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {[launch.model, launch.effort].filter(Boolean).join(' · ') || '—'}
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">—</div>
      )}
    </div>
  )
}

function ArtifactRow({ artifact }: { artifact: NodeAttemptView['artifactsJson'][number] }) {
  return (
    <li className="flex items-center gap-1.5 text-xs">
      {artifact.exists ? (
        <CircleCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
      )}
      <span className="truncate font-mono">{artifact.path}</span>
    </li>
  )
}

/**
 * FR-036: requested vs effective launch, result, artifacts, and the transcript/workspace-diff
 * jumps — for the attempt currently representing `nodeId` (see `latestNodeAttempt`).
 */
export default function AttemptPanel({
  definition,
  snapshot,
  nodeId,
  runtimeEnvironmentId
}: AttemptPanelProps): React.JSX.Element | null {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId)
  const attempt = latestNodeAttempt(snapshot.attempts, nodeId)
  const worktree = useWorktreeById(attempt?.workspaceWorktreeId ?? null)
  const openAllDiffs = useAppStore((state) => state.openAllDiffs)

  if (!node) {
    return null
  }

  if (!attempt) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto scrollbar-sleek p-4">
        <h2 className="text-sm font-semibold">{node.title}</h2>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.run-view.AttemptPanel.notStarted',
            "This node hasn't run yet."
          )}
        </p>
      </div>
    )
  }

  const handleOpenTranscript = (): void => {
    if (!attempt.taskId) {
      return
    }
    focusRuntimeOrchestrationTask(attempt.taskId, runtimeEnvironmentId, (handle) =>
      focusRendererTerminalHandle(handle, runtimeEnvironmentId)
    ).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
  }

  const handleOpenWorkspaceDiff = (): void => {
    if (!worktree) {
      return
    }
    openAllDiffs(worktree.id, worktree.path)
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto scrollbar-sleek p-4">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{node.title}</h2>
        <AttemptStateBadge state={attempt.state} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <LaunchSummary
          label={translate(
            'auto.components.workflows.run-view.AttemptPanel.requested',
            'Requested'
          )}
          launch={attempt.requestedLaunch}
        />
        <LaunchSummary
          label={translate(
            'auto.components.workflows.run-view.AttemptPanel.effective',
            'Effective'
          )}
          launch={attempt.effectiveLaunch}
        />
      </div>

      {attempt.failureReason ? (
        <p className="text-xs text-destructive">{attempt.failureReason}</p>
      ) : null}

      {attempt.resultJson !== undefined ? (
        <InspectorField
          label={translate('auto.components.workflows.run-view.AttemptPanel.result', 'Result')}
        >
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/20 p-3 font-mono text-[11px] text-muted-foreground scrollbar-sleek">
            {JSON.stringify(attempt.resultJson, null, 2)}
          </pre>
        </InspectorField>
      ) : null}

      {attempt.artifactsJson.length > 0 ? (
        <InspectorField
          label={translate(
            'auto.components.workflows.run-view.AttemptPanel.artifacts',
            'Artifacts'
          )}
        >
          <ul className="space-y-1">
            {attempt.artifactsJson.map((artifact) => (
              <ArtifactRow key={artifact.path} artifact={artifact} />
            ))}
          </ul>
        </InspectorField>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!attempt.taskId}
          onClick={handleOpenTranscript}
        >
          <Terminal />
          {translate(
            'auto.components.workflows.run-view.AttemptPanel.openTranscript',
            'Open transcript'
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!worktree}
          onClick={handleOpenWorkspaceDiff}
        >
          <FileDiff />
          {translate(
            'auto.components.workflows.run-view.AttemptPanel.openWorkspaceDiff',
            'Open workspace diff'
          )}
        </Button>
      </div>
    </div>
  )
}
