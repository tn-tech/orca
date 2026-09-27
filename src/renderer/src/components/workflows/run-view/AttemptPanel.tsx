import React from 'react'
import { AlertCircle, CircleCheck, FileDiff, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { focusRendererTerminalHandle } from '@/components/terminal-pane/terminal-handle-links'
import { focusRuntimeOrchestrationTask } from '@/components/terminal-pane/terminal-orchestration-task-links'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  RuntimeWorkflowSettings,
  WorkflowRunSnapshotView
} from '@/runtime/runtime-workflow-client'
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
import JoinBranchOutcomes, { readJoinBranches } from './JoinBranchOutcomes'
import QuestionCard from './QuestionCard'
import RouterChoiceSummary, { readRouterChoice } from './RouterChoiceSummary'
import {
  attemptsByIteration,
  latestNodeAttempt,
  loopActiveIteration,
  provisioningRecordFor
} from './use-workflow-run-snapshot'

export type AttemptPanelProps = {
  definition: Workflow
  snapshot: WorkflowRunSnapshotView
  nodeId: string
  /** The workflow feature's active runtime target (see `getActiveRuntimeTarget`); `null` is desktop. */
  runtimeEnvironmentId: string | null
  settings: RuntimeWorkflowSettings
}

/** A cancelled attempt (including a Join settled `join_skipped`) isn't a failure (review note):
 *  only `failed` gets the destructive treatment. */
function attemptReasonClassName(state: WorkflowAttemptState): string {
  return state === 'failed' ? 'text-destructive' : 'text-muted-foreground'
}

/** `join_skipped` (workflow-join-settlement.ts's `JOIN_SKIPPED_REASON`) is a machine reason code,
 *  not copy meant to be read as-is (review note) — every other `failureReason` is already a
 *  free-text message from the engine. */
function attemptReasonLabel(failureReason: string): string {
  return failureReason === 'join_skipped'
    ? translate(
        'auto.components.workflows.run-view.AttemptPanel.reasonJoinSkipped',
        'Every branch was skipped.'
      )
    : failureReason
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

/** One row per completed/attempted loop iteration (FR-035, US2 AS1/AS3): state plus a compact
 *  result/failure summary, so a rejected-then-approved review loop's history stays visible after
 *  the panel moves on to showing the latest attempt above. */
function IterationRow({ attempt }: { attempt: NodeAttemptView }): React.JSX.Element {
  return (
    <li className="rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">
          {translate(
            'auto.components.workflows.run-view.AttemptPanel.iterationLabel',
            'Iteration {{n}}',
            { n: attempt.iteration }
          )}
        </span>
        <AttemptStateBadge state={attempt.state} />
      </div>
      {attempt.resultJson !== undefined ? (
        <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/20 p-2 font-mono text-[11px] text-muted-foreground scrollbar-sleek">
          {JSON.stringify(attempt.resultJson, null, 2)}
        </pre>
      ) : null}
      {attempt.failureReason ? (
        <p className={cn('mt-1.5 text-[11px]', attemptReasonClassName(attempt.state))}>
          {attemptReasonLabel(attempt.failureReason)}
        </p>
      ) : null}
    </li>
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
  runtimeEnvironmentId,
  settings
}: AttemptPanelProps): React.JSX.Element | null {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId)
  const attempt = latestNodeAttempt(snapshot.attempts, nodeId)
  const worktree = useWorktreeById(attempt?.workspaceWorktreeId ?? null)
  const openAllDiffs = useAppStore((state) => state.openAllDiffs)

  if (!node) {
    return null
  }

  // A Loop's own attempt sits at iteration 0 regardless of progress (review round 2), so its
  // iteration badge and per-iteration rows come from its body instead — the exit node's attempts
  // are what the engine's `exitCondition` actually evaluates each pass, so they stand in for
  // "this iteration's result".
  const iterationDisplay =
    node.type === 'loop' ? loopActiveIteration(node, snapshot.attempts) : attempt?.iteration
  const iterations = attemptsByIteration(
    snapshot.attempts,
    node.type === 'loop' ? node.exitNodeId : nodeId
  )
  const joinBranches = node.type === 'join' ? readJoinBranches(attempt?.resultJson) : undefined
  const routerChoice = node.type === 'router' ? readRouterChoice(attempt?.resultJson) : undefined

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

  const pendingQuestions = snapshot.questions.filter(
    (question) => question.attemptId === attempt.id && question.state === 'pending'
  )
  const provisioning = provisioningRecordFor(snapshot.events, attempt.id)

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
        {iterationDisplay !== undefined && iterationDisplay > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {translate(
              'auto.components.workflows.run-view.AttemptPanel.iterationLabel',
              'Iteration {{n}}',
              { n: iterationDisplay }
            )}
          </span>
        ) : null}
        <AttemptStateBadge state={attempt.state} />
      </div>

      {pendingQuestions.length > 0 ? (
        <div className="space-y-2">
          {pendingQuestions.map((question) => (
            <QuestionCard key={question.id} question={question} settings={settings} />
          ))}
        </div>
      ) : null}

      {provisioning &&
      (provisioning.installed.length > 0 || provisioning.promptFallback.length > 0) ? (
        <InspectorField
          label={translate(
            'auto.components.workflows.run-view.AttemptPanel.provisioning',
            'Provisioning'
          )}
        >
          <div className="space-y-1.5 text-xs">
            {provisioning.installed.length > 0 ? (
              <p>
                {translate(
                  'auto.components.workflows.run-view.AttemptPanel.provisioningInstalled',
                  'Installed: {{skills}}',
                  { skills: provisioning.installed.join(', ') }
                )}
              </p>
            ) : null}
            {provisioning.promptFallback.length > 0 ? (
              <p className="text-muted-foreground">
                {translate(
                  'auto.components.workflows.run-view.AttemptPanel.provisioningPromptFallback',
                  'Included in the prompt instead (no workspace location): {{skills}}',
                  { skills: provisioning.promptFallback.join(', ') }
                )}
              </p>
            ) : null}
          </div>
        </InspectorField>
      ) : null}

      {iterations.length > 1 ? (
        <InspectorField
          label={translate(
            'auto.components.workflows.run-view.AttemptPanel.iterations',
            'Iterations'
          )}
        >
          <ul className="space-y-1.5">
            {iterations.map((iterationAttempt) => (
              <IterationRow key={iterationAttempt.id} attempt={iterationAttempt} />
            ))}
          </ul>
        </InspectorField>
      ) : null}

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
        <p className={cn('text-xs', attemptReasonClassName(attempt.state))}>
          {attemptReasonLabel(attempt.failureReason)}
        </p>
      ) : null}

      {joinBranches ? (
        <JoinBranchOutcomes branches={joinBranches} />
      ) : routerChoice ? (
        <RouterChoiceSummary result={routerChoice} />
      ) : attempt.resultJson !== undefined ? (
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
