import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { OpenWorkflowRef } from './workflow-editor-session-types'

export type UseWorkflowPageResumeParams = {
  repoId: string | undefined
  openRef: OpenWorkflowRef | null
  runId: string | null
  open: (ref: OpenWorkflowRef) => unknown
  openRun: (runId: string) => void
}

/** F9: the page unmounts when the user navigates away, so the open workflow and shown run are
 *  parked in the store (session-local, like `taskListPosition`) and reopened on the next mount. */
export function useWorkflowPageResume({
  repoId,
  openRef,
  runId,
  open,
  openRun
}: UseWorkflowPageResumeParams): void {
  const resume = useAppStore((s) => s.workflowsResume)
  const setWorkflowsResume = useAppStore((s) => s.setWorkflowsResume)
  const pendingRestore = useRef(resume)
  const hadOpenRef = useRef(false)

  useEffect(() => {
    const remembered = pendingRestore.current
    if (!remembered || !repoId) {
      return
    }
    pendingRestore.current = null
    if (remembered.repoId !== repoId) {
      return
    }
    void open({ name: remembered.name, source: remembered.source })
    if (remembered.runId) {
      openRun(remembered.runId)
    }
  }, [repoId, open, openRun])

  useEffect(() => {
    if (!openRef) {
      // Not-yet-restored (or never opened) must not wipe what the restore is about to read.
      if (hadOpenRef.current) {
        setWorkflowsResume(null)
      }
      return
    }
    hadOpenRef.current = true
    if (repoId) {
      setWorkflowsResume({ repoId, name: openRef.name, source: openRef.source, runId })
    }
  }, [repoId, openRef, runId, setWorkflowsResume])
}
