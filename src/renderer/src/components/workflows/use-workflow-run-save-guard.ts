import { useCallback, useRef, useState } from 'react'
import type { WorkflowEditorSession } from './workflow-editor-session-types'

/** The slice of `WorkflowEditorSession` this guard reads/calls — narrowed so tests can supply a
 *  lightweight fake instead of the full session shape. */
export type WorkflowRunSaveGuardSession = Pick<
  WorkflowEditorSession,
  'status' | 'isDraft' | 'save'
> & {
  editor: { state: { dirty: boolean } }
}

export type UseWorkflowRunSaveGuardParams = {
  session: WorkflowRunSaveGuardSession
  /** FR-009: the same blocking-problems check Run's own disabled state already gates on. */
  blockingProblems: boolean
  start: (objective: string) => Promise<void>
}

export type WorkflowRunSaveGuard = {
  /** Run's onClick: prompts for dirty edits (F8) instead of silently running the on-disk file. */
  requestRun: (objective: string) => void
  confirmOpen: boolean
  confirmSaveAndRun: () => void
  cancelSaveAndRun: () => void
}

/** F8: Run must never silently execute the on-disk file while the editor has unsaved edits — ask
 *  "Save and run" first, abort on a failed save, and re-check blocking problems once the save
 *  lands (F7 semantics) before actually starting the run. */
export function useWorkflowRunSaveGuard({
  session,
  blockingProblems,
  start
}: UseWorkflowRunSaveGuardParams): WorkflowRunSaveGuard {
  const [confirmObjective, setConfirmObjective] = useState<string | null>(null)
  const dirty = session.status === 'ready' && session.editor.state.dirty && !session.isDraft
  // Read after `await session.save()` below, so the check uses the value current when the save
  // lands, not the one captured when the button was clicked.
  const blockingProblemsRef = useRef(blockingProblems)
  blockingProblemsRef.current = blockingProblems

  const requestRun = useCallback(
    (objective: string) => {
      if (dirty) {
        setConfirmObjective(objective)
        return
      }
      void start(objective)
    },
    [dirty, start]
  )

  const confirmSaveAndRun = useCallback(() => {
    if (confirmObjective === null) {
      return
    }
    const objective = confirmObjective
    setConfirmObjective(null)
    void (async () => {
      const saved = await session.save()
      // A failed save already toasted its own error; a blocking problem once the save lands
      // still blocks Run (F7 semantics) — either way, no run.
      if (!saved || blockingProblemsRef.current) {
        return
      }
      await start(objective)
    })()
  }, [confirmObjective, session, start])

  const cancelSaveAndRun = useCallback(() => setConfirmObjective(null), [])

  return {
    requestRun,
    confirmOpen: confirmObjective !== null,
    confirmSaveAndRun,
    cancelSaveAndRun
  }
}
