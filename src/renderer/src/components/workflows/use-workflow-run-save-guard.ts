import { useCallback, useMemo, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'
import { createLocalGraphValidationContext } from './editor/workflow-graph-validation-context'
import { hasBlockingProblemsAfterSave } from './workflow-post-save-validation'
import type { WorkflowEditorSession } from './workflow-editor-session-types'

/** The slice of `WorkflowEditorSession` this guard reads/calls — narrowed so tests can supply a
 *  lightweight fake instead of the full session shape. */
export type WorkflowRunSaveGuardSession = Pick<
  WorkflowEditorSession,
  'status' | 'isDraft' | 'save' | 'conflict'
> & {
  editor: { state: { dirty: boolean; definition: Workflow } }
}

export type UseWorkflowRunSaveGuardParams = {
  session: WorkflowRunSaveGuardSession
  settings: RuntimeWorkflowSettings
  repoId: string | undefined
  start: (objective: string) => Promise<void>
}

export type WorkflowRunSaveGuard = {
  /** Run's onClick: prompts for dirty edits (F8) instead of silently running the on-disk file. */
  requestRun: (objective: string) => void
  confirmOpen: boolean
  confirmSaveAndRun: () => void
  cancelSaveAndRun: () => void
  /** True from "Save and run" until the save-then-run chain settles. */
  busy: boolean
  /** Run's disabled reason while `busy`, e.g. "Saving…" — stops a second click from re-opening
   *  the prompt or double-starting the run (F8 fix round 1). */
  busyReason: string | undefined
}

/** F8: Run must never silently execute the on-disk file while the editor has unsaved edits — ask
 *  "Save and run" first, abort on a failed save, and re-check blocking problems once the save
 *  lands (F7 semantics) before actually starting the run. Fix round 1: a file conflict always
 *  takes priority over this prompt — it closes (or never opens) so `FileConflictDialog` is the
 *  only modal, and the run never proceeds through a conflict. */
export function useWorkflowRunSaveGuard({
  session,
  settings,
  repoId,
  start
}: UseWorkflowRunSaveGuardParams): WorkflowRunSaveGuard {
  const [confirmObjective, setConfirmObjective] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const validationContext = useMemo(() => createLocalGraphValidationContext(), [])
  const dirty = session.status === 'ready' && session.editor.state.dirty && !session.isDraft

  // Adjust state during render (React's documented pattern for resetting state when a condition
  // becomes true) instead of an effect: a conflict arising while this prompt is open must close it
  // in the same render, with no stale extra frame — FileConflictDialog owns the modal from here.
  // The user resolves the conflict, then presses Run again; this prompt never reopens on its own.
  const previousConflictRef = useRef(session.conflict)
  if (session.conflict !== previousConflictRef.current) {
    previousConflictRef.current = session.conflict
    if (session.conflict !== null && confirmObjective !== null) {
      setConfirmObjective(null)
    }
  }

  const requestRun = useCallback(
    (objective: string) => {
      // A conflict is either already showing its own dialog or about to (case: Run pressed while
      // a conflict already exists) — it owns the modal, so this never opens on top of it. `busy`
      // stops a second click from firing a second save-then-run chain.
      if (busy || session.conflict !== null) {
        return
      }
      if (dirty) {
        setConfirmObjective(objective)
        return
      }
      void start(objective)
    },
    [busy, session.conflict, dirty, start]
  )

  const confirmSaveAndRun = useCallback(() => {
    if (confirmObjective === null) {
      return
    }
    const objective = confirmObjective
    setConfirmObjective(null)
    setBusy(true)
    void (async () => {
      try {
        const saved = await session.save()
        // A failed save already toasted its own error. A conflict the save itself hits
        // (`workflow_file_conflict`) surfaces as `saved === false` here — either way, no run.
        if (!saved) {
          return
        }
        const blocked = await hasBlockingProblemsAfterSave(
          session.editor.state.definition,
          validationContext,
          settings,
          repoId
        )
        if (blocked) {
          return
        }
        await start(objective)
      } finally {
        setBusy(false)
      }
    })()
  }, [confirmObjective, session, settings, repoId, start, validationContext])

  const cancelSaveAndRun = useCallback(() => setConfirmObjective(null), [])

  return {
    requestRun,
    confirmOpen: confirmObjective !== null,
    confirmSaveAndRun,
    cancelSaveAndRun,
    busy,
    busyReason: busy
      ? translate('auto.components.workflows.use-workflow-run-save-guard.saving', 'Saving…')
      : undefined
  }
}
