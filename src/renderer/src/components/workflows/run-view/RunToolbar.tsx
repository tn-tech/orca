import React, { useId, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import DisabledReasonButton from '../DisabledReasonButton'
import type { WorkflowRunState } from '../../../../../shared/workflows/workflow-node-states'

/** Waiting still counts as active (a pending approval/question), FR-032. */
const ACTIVE_RUN_STATES: ReadonlySet<WorkflowRunState> = new Set([
  'queued',
  'running',
  'paused',
  'waiting'
])

/** Shared with `RunHistory` (list rows show the same vocabulary as this toolbar). */
export function runStateLabel(state: WorkflowRunState): string {
  switch (state) {
    case 'queued':
      return translate('auto.components.workflows.run-view.RunToolbar.stateQueued', 'Queued')
    case 'running':
      return translate('auto.components.workflows.run-view.RunToolbar.stateRunning', 'Running')
    case 'paused':
      return translate('auto.components.workflows.run-view.RunToolbar.statePaused', 'Paused')
    case 'waiting':
      return translate('auto.components.workflows.run-view.RunToolbar.stateWaiting', 'Waiting')
    case 'completed':
      return translate('auto.components.workflows.run-view.RunToolbar.stateCompleted', 'Completed')
    case 'failed':
      return translate('auto.components.workflows.run-view.RunToolbar.stateFailed', 'Failed')
    case 'cancelled':
      return translate('auto.components.workflows.run-view.RunToolbar.stateCancelled', 'Cancelled')
  }
}

export type RunToolbarProps = {
  /** The open workflow's most recent run state; absent until the user presses Run once. */
  runState?: WorkflowRunState
  /** That run's objective, shown read-only in place of the input while it's active. */
  runObjective?: string
  /** FR-009: Run stays disabled while a blocking validation problem remains. */
  canRun: boolean
  /** Shown as the Run button's reason when `canRun` is false and there's a reason to explain
   *  (e.g. US6 AS2: an unsaved draft has no file to run against yet). */
  disabledReason?: string
  starting: boolean
  /** Both optional together: omitting them hides Stop entirely, e.g. when `runControls` (below)
   *  owns pause/resume/cancel for this run instead. */
  stopping?: boolean
  onRun: (objective: string) => void
  onStop?: () => void
  /** Rendered next to the run state while a run is active (e.g. `<RunControls />`) — in the same
   *  wrapping unit as the state label, so the two never wrap apart from each other. */
  runControls?: React.ReactNode
}

/** Run view controls (US1 AS2/AS3): an objective, and either Run or the run's state plus its
 *  controls — one non-wrapping unit, so the caller's wrapping row moves it whole. Only the
 *  objective flexes; explicit widths on it keep the unit's min-content (what decides the wrap)
 *  small and predictable. */
export default function RunToolbar({
  runState,
  runObjective,
  canRun,
  disabledReason,
  starting,
  stopping,
  onRun,
  onStop,
  runControls
}: RunToolbarProps): React.JSX.Element {
  // Not cleared on run start/finish: keeping the typed objective around is a relaunch convenience
  // once the input reappears after the run reaches a terminal state.
  const [objective, setObjective] = useState('')
  const objectiveId = useId()
  const isActive = runState !== undefined && ACTIVE_RUN_STATES.has(runState)
  const objectiveTrimmed = objective.trim()
  // Priority is the external reason (draft/blocking problems, from WorkflowsPage), then the
  // in-flight start, then the empty objective — each state gets exactly one explanation.
  const runReason = !canRun
    ? (disabledReason ??
      translate('auto.components.workflows.run-view.RunToolbar.notReady', "Can't run yet."))
    : starting
      ? translate('auto.components.workflows.run-view.RunToolbar.starting', 'Starting the run…')
      : objectiveTrimmed.length === 0
        ? translate(
            'auto.components.workflows.run-view.RunToolbar.objectiveRequired',
            'Enter an objective.'
          )
        : undefined
  const stateLabel = runState ? (
    <span className="shrink-0 text-xs font-medium text-muted-foreground">
      {runStateLabel(runState)}
    </span>
  ) : null

  return (
    <div className="flex flex-1 items-center gap-1.5">
      {isActive ? (
        // A wide toolbar (the WorkflowsPage row is the container) wraps History/Re-layout rather
        // than squeezing the objective to a sliver.
        <p
          className="w-0 min-w-10 flex-1 truncate text-sm text-foreground @min-[48rem]:min-w-40"
          title={runObjective}
        >
          {runObjective}
        </p>
      ) : (
        <>
          <Label htmlFor={objectiveId} className="shrink-0">
            {translate('auto.components.workflows.run-view.RunToolbar.objectiveLabel', 'Objective')}
          </Label>
          <Input
            id={objectiveId}
            className="h-8 w-0 min-w-20 flex-1"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder={translate(
              'auto.components.workflows.run-view.RunToolbar.objectivePlaceholder',
              'Add tests'
            )}
          />
        </>
      )}
      {stateLabel}
      {isActive ? (
        <>
          {runControls}
          {onStop ? (
            <Button type="button" variant="outline" size="sm" disabled={stopping} onClick={onStop}>
              <Square />
              {translate('auto.components.workflows.run-view.RunToolbar.stop', 'Stop')}
            </Button>
          ) : null}
        </>
      ) : (
        <DisabledReasonButton reason={runReason} onClick={() => onRun(objectiveTrimmed)}>
          <Play />
          {translate('auto.components.workflows.run-view.RunToolbar.run', 'Run')}
        </DisabledReasonButton>
      )}
    </div>
  )
}
