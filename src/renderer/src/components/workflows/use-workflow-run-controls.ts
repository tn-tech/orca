import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import {
  workflowRunCancel,
  workflowRunPause,
  workflowRunResume,
  workflowRunStart,
  type RuntimeWorkflowSettings,
  type WorkflowRunSnapshotView
} from '@/runtime/runtime-workflow-client'
import type { OpenWorkflowRef } from './workflow-editor-session-types'
import { useWorkflowRunSnapshot } from './run-view/use-workflow-run-snapshot'

export type WorkflowRunControls = {
  runId: string | null
  snapshot: WorkflowRunSnapshotView | null
  /** The shown run's snapshot could not be fetched. */
  loadFailed: boolean
  starting: boolean
  stopping: boolean
  pausing: boolean
  resuming: boolean
  start: (objective: string) => Promise<void>
  stop: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  /** Displays a past run (RunHistory's "open"/"Rerun from this node"), reusing the same live
   *  snapshot pipeline a freshly started run uses — `activeRunId` is really "the run currently
   *  shown", not only "the run this session started". */
  openRun: (runId: string) => void
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
  const [runPausing, setRunPausing] = useState(false)
  const [runResuming, setRunResuming] = useState(false)
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
      // `workflow_not_implemented`: an older host whose `workflow.run.cancel` is still the pre-U58
      // stub. `method_not_found`: a host that predates the method entirely (mixed-version pairing,
      // see docs/reference/remote-wire-compatibility.md). Either way this is an expected gap, not
      // a failure the user needs to retry or report.
      if (
        hasRuntimeRpcErrorCode(error, 'workflow_not_implemented') ||
        hasRuntimeRpcErrorCode(error, 'method_not_found')
      ) {
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

  const pauseRun = useCallback(async () => {
    if (!activeRunId) {
      return
    }
    setRunPausing(true)
    try {
      await workflowRunPause(settings, activeRunId)
    } catch (error) {
      if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
        toast.message(
          translate(
            'auto.components.workflows.use-workflows-page-controller.runPauseNotImplemented',
            "Pausing a run isn't available on this host yet."
          )
        )
        return
      }
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.workflows.use-workflows-page-controller.runPauseFailed',
              'Failed to pause the run.'
            )
      )
    } finally {
      setRunPausing(false)
    }
  }, [activeRunId, settings])

  const resumeRun = useCallback(async () => {
    if (!activeRunId) {
      return
    }
    setRunResuming(true)
    try {
      await workflowRunResume(settings, activeRunId)
    } catch (error) {
      if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
        toast.message(
          translate(
            'auto.components.workflows.use-workflows-page-controller.runResumeNotImplemented',
            "Resuming a run isn't available on this host yet."
          )
        )
        return
      }
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.workflows.use-workflows-page-controller.runResumeFailed',
              'Failed to resume the run.'
            )
      )
    } finally {
      setRunResuming(false)
    }
  }, [activeRunId, settings])

  const clearActiveRun = useCallback(() => setActiveRunId(null), [])
  const openRun = useCallback((runId: string) => setActiveRunId(runId), [])

  const run = useMemo(
    () => ({
      runId: activeRunId,
      snapshot: runSnapshot.snapshot,
      loadFailed: runSnapshot.error !== null,
      starting: runStarting,
      stopping: runStopping,
      pausing: runPausing,
      resuming: runResuming,
      start: startRun,
      stop: stopRun,
      pause: pauseRun,
      resume: resumeRun,
      openRun
    }),
    [
      activeRunId,
      runSnapshot.snapshot,
      runSnapshot.error,
      runStarting,
      runStopping,
      runPausing,
      runResuming,
      startRun,
      stopRun,
      pauseRun,
      resumeRun,
      openRun
    ]
  )

  return { run, clearActiveRun }
}
