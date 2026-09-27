import React, { useId, useState } from 'react'
import { LayoutGrid, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { WorkflowRunState } from '../../../../../shared/workflows/workflow-node-states'

/** Waiting still counts as active (a pending approval/question), FR-032. */
const ACTIVE_RUN_STATES: ReadonlySet<WorkflowRunState> = new Set([
  'queued',
  'running',
  'paused',
  'waiting'
])

function runStateLabel(state: WorkflowRunState): string {
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
  /** Shown as the Run button's title when `canRun` is false and there's a reason to explain
   *  (e.g. US6 AS2: an unsaved draft has no file to run against yet). */
  disabledReason?: string
  starting: boolean
  stopping: boolean
  onRun: (objective: string) => void
  onStop: () => void
  /** Re-runs `workflow-auto-layout.ts` for nodes the user hasn't dragged (FR-010). */
  onRelayout: () => void
}

/** Run view controls (US1 AS2/AS3): an objective, Run/Stop, and auto-layout. */
export default function RunToolbar({
  runState,
  runObjective,
  canRun,
  disabledReason,
  starting,
  stopping,
  onRun,
  onStop,
  onRelayout
}: RunToolbarProps): React.JSX.Element {
  // Not cleared on run start/finish: keeping the typed objective around is a relaunch convenience
  // once the input reappears after the run reaches a terminal state.
  const [objective, setObjective] = useState('')
  const objectiveId = useId()
  const isActive = runState !== undefined && ACTIVE_RUN_STATES.has(runState)

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        {isActive ? (
          <p className="truncate text-sm text-foreground" title={runObjective}>
            {runObjective}
          </p>
        ) : (
          <>
            <Label htmlFor={objectiveId} className="sr-only">
              {translate(
                'auto.components.workflows.run-view.RunToolbar.objectiveLabel',
                'Objective'
              )}
            </Label>
            <Input
              id={objectiveId}
              className="h-8"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder={translate(
                'auto.components.workflows.run-view.RunToolbar.objectivePlaceholder',
                'What should this run accomplish?'
              )}
            />
          </>
        )}
      </div>
      {runState ? (
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {runStateLabel(runState)}
        </span>
      ) : null}
      {isActive ? (
        <Button type="button" variant="outline" size="sm" disabled={stopping} onClick={onStop}>
          <Square />
          {translate('auto.components.workflows.run-view.RunToolbar.stop', 'Stop')}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={!canRun || starting || objective.trim().length === 0}
          title={!canRun ? disabledReason : undefined}
          onClick={() => onRun(objective.trim())}
        >
          <Play />
          {translate('auto.components.workflows.run-view.RunToolbar.run', 'Run')}
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" onClick={onRelayout}>
        <LayoutGrid />
        {translate('auto.components.workflows.run-view.RunToolbar.relayout', 'Re-layout')}
      </Button>
    </div>
  )
}
