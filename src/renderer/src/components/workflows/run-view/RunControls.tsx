import React, { useState } from 'react'
import { Loader2, Pause, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import {
  canTransition,
  TERMINAL_RUN_STATES,
  type WorkflowRunState
} from '../../../../../shared/workflows/workflow-node-states'

export type RunControlsProps = {
  /** `undefined` before a run exists; hidden entirely once the run reaches a terminal state. */
  runState: WorkflowRunState | undefined
  pausing: boolean
  resuming: boolean
  cancelling: boolean
  onPause: () => void
  onResume: () => void
  onCancel: () => void
}

/**
 * Pause/resume/cancel for the run currently shown in the run view (U58/US8). Enabling reads
 * `RUN_TRANSITIONS` (workflow-node-states.ts) instead of a hard-coded state list, so e.g. a queued
 * run — which has no `paused` transition — disables Pause without special-casing `queued` here.
 * Cancel is irreversible, so it confirms first (mirrors `WorkflowDeleteDialog`).
 */
export default function RunControls({
  runState,
  pausing,
  resuming,
  cancelling,
  onPause,
  onResume,
  onCancel
}: RunControlsProps): React.JSX.Element | null {
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  if (runState === undefined || TERMINAL_RUN_STATES.has(runState)) {
    return null
  }

  const isPaused = runState === 'paused'
  const canPause = canTransition('run', runState, 'paused')
  const canCancel = canTransition('run', runState, 'cancelled')

  return (
    <div className="flex items-center gap-2">
      {isPaused ? (
        <Button type="button" variant="outline" size="sm" disabled={resuming} onClick={onResume}>
          {resuming ? <Loader2 className="animate-spin" /> : <Play />}
          {translate('auto.components.workflows.run-view.RunControls.resume', 'Resume')}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPause || pausing}
          onClick={onPause}
        >
          {pausing ? <Loader2 className="animate-spin" /> : <Pause />}
          {translate('auto.components.workflows.run-view.RunControls.pause', 'Pause')}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canCancel || cancelling}
        onClick={() => setConfirmingCancel(true)}
      >
        <Square />
        {translate('auto.components.workflows.run-view.RunControls.cancel', 'Cancel')}
      </Button>
      <Dialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.workflows.run-view.RunControls.confirmTitle',
                'Cancel this run?'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.workflows.run-view.RunControls.confirmDescription',
                'Every active node stops. This cannot be undone.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmingCancel(false)}>
              {translate(
                'auto.components.workflows.run-view.RunControls.confirmDismiss',
                'Keep running'
              )}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancelling}
              onClick={() => {
                setConfirmingCancel(false)
                onCancel()
              }}
            >
              {translate(
                'auto.components.workflows.run-view.RunControls.confirmConfirm',
                'Cancel run'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
