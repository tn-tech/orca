import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { OpenWorkflowRef } from './workflow-editor-session-types'

export type UseWorkflowPageResumeParams = {
  repoId: string | undefined
  openRef: OpenWorkflowRef | null
  runId: string | null
  /** The shown run's snapshot fetch failed (e.g. the run was deleted). */
  runLoadFailed: boolean
  open: (ref: OpenWorkflowRef) => unknown
  openRun: (runId: string) => void
  dropRun: () => void
}

/** F9: the page unmounts when the user navigates away, so the open workflow and shown run are
 *  parked in the store (session-local, like `taskListPosition`) and reopened on the next mount.
 *  Unsaved editor edits are not restored: only the saved workflow reopens. */
export function useWorkflowPageResume({
  repoId,
  openRef,
  runId,
  runLoadFailed,
  open,
  openRun,
  dropRun
}: UseWorkflowPageResumeParams): void {
  const resume = useAppStore((s) => s.workflowsResume)
  const setWorkflowsResume = useAppStore((s) => s.setWorkflowsResume)
  const pendingRestore = useRef(resume)
  const restoredRunId = useRef<string | null>(null)
  const hadOpenRef = useRef(false)
  // The editor keeps a workflow open across a project switch, so the project it was opened in is
  // recorded by the ref's identity rather than read from the current `repoId`.
  const owner = useRef<{ ref: OpenWorkflowRef; repoId: string } | null>(null)

  useEffect(() => {
    const remembered = pendingRestore.current
    if (!remembered || !repoId) {
      return
    }
    pendingRestore.current = null
    // Consumed either way: a restore that fails must not repeat on every visit.
    setWorkflowsResume(null)
    if (remembered.repoId !== repoId) {
      return
    }
    void open({ name: remembered.name, source: remembered.source })
    if (remembered.runId) {
      restoredRunId.current = remembered.runId
      openRun(remembered.runId)
    }
  }, [repoId, open, openRun, setWorkflowsResume])

  useEffect(() => {
    if (restoredRunId.current === null || restoredRunId.current !== runId || !runLoadFailed) {
      return
    }
    restoredRunId.current = null
    dropRun()
    toast.message(
      translate(
        'auto.components.workflows.use-workflow-page-resume.runUnavailable',
        'The run you were viewing is no longer available.'
      )
    )
  }, [runId, runLoadFailed, dropRun])

  useEffect(() => {
    if (!openRef) {
      // Not-yet-restored (or never opened) must not wipe what the restore is about to read.
      if (hadOpenRef.current) {
        setWorkflowsResume(null)
      }
      return
    }
    hadOpenRef.current = true
    if (owner.current?.ref !== openRef && repoId) {
      owner.current = { ref: openRef, repoId }
    }
    if (owner.current) {
      setWorkflowsResume({
        repoId: owner.current.repoId,
        name: openRef.name,
        source: openRef.source,
        runId
      })
    }
  }, [repoId, openRef, runId, setWorkflowsResume])
}
