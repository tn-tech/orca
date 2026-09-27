import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import {
  workflowRunCancel,
  workflowRunStart,
  type RuntimeWorkflowSettings,
  type WorkflowRunSnapshotView
} from '@/runtime/runtime-workflow-client'
import type { OpenWorkflowRef } from './workflow-editor-session-types'
import { useWorkflowRunSnapshot } from './run-view/use-workflow-run-snapshot'

export type WorkflowRunControls = {
  runId: string | null
  snapshot: WorkflowRunSnapshotView | null
  starting: boolean
  stopping: boolean
  start: (objective: string) => Promise<void>
  stop: () => Promise<void>
}

export type UseWorkflowRunControlsParams = {
  settings: RuntimeWorkflowSettings
  repoId: string | undefined
  openRef: OpenWorkflowRef | null
}

export type WorkflowRunControlsController = {
  run: WorkflowRunControls
  /** Drops the active run — call when the open workflow changes (open/create/duplicate/delete/draft),
   *  since a run belongs to the workflow it started against. */
  clearActiveRun: () => void
}

/** FR-032/FR-035: start/stop a run for the open workflow and track its live snapshot. */
export function useWorkflowRunControls({
  settings,
  repoId,
  openRef
}: UseWorkflowRunControlsParams): WorkflowRunControlsController {
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [runStarting, setRunStarting] = useState(false)
  const [runStopping, setRunStopping] = useState(false)
  const runSnapshot = useWorkflowRunSnapshot({ settings, runId: activeRunId })

  const startRun = useCallback(
    async (objective: string) => {
      if (!repoId || !openRef) {
        return
      }
      setRunStarting(true)
      try {
        const result = await workflowRunStart(settings, {
          repo: repoId,
          name: openRef.name,
          source: openRef.source,
          objective
        })
        setActiveRunId(result.runId)
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.workflows.use-workflows-page-controller.runStartFailed',
                'Failed to start the run.'
              )
        )
      } finally {
        setRunStarting(false)
      }
    },
    [repoId, openRef, settings]
  )

  const stopRun = useCallback(async () => {
    if (!activeRunId) {
      return
    }
    setRunStopping(true)
    try {
      await workflowRunCancel(settings, activeRunId)
    } catch (error) {
      // Why not surfaced as an error: `workflow.run.cancel` is a host stub today (US8); this is
      // an expected, temporary gap rather than a failure the user needs to retry or report.
      if (hasRuntimeRpcErrorCode(error, 'workflow_not_implemented')) {
        toast.message(
          translate(
            'auto.components.workflows.use-workflows-page-controller.runStopNotImplemented',
            "Stopping a run isn't available yet."
          )
        )
        return
      }
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.workflows.use-workflows-page-controller.runStopFailed',
              'Failed to stop the run.'
            )
      )
    } finally {
      setRunStopping(false)
    }
  }, [activeRunId, settings])

  const clearActiveRun = useCallback(() => setActiveRunId(null), [])

  const run = useMemo(
    () => ({
      runId: activeRunId,
      snapshot: runSnapshot.snapshot,
      starting: runStarting,
      stopping: runStopping,
      start: startRun,
      stop: stopRun
    }),
    [activeRunId, runSnapshot.snapshot, runStarting, runStopping, startRun, stopRun]
  )

  return { run, clearActiveRun }
}
