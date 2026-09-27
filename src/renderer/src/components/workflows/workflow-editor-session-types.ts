import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunSource } from '../../../../shared/workflows/workflow-run-types'
import type { WorkflowEditorController } from './editor/use-workflow-editor-state'
import type { WorkflowFileConflictReason } from './editor/FileConflictDialog'

export type OpenWorkflowRef = { name: string; source: WorkflowRunSource }

export type WorkflowEditorSessionStatus = 'empty' | 'loading' | 'ready' | 'error'

export type WorkflowEditorSession = {
  status: WorkflowEditorSessionStatus
  openRef: OpenWorkflowRef | null
  editor: WorkflowEditorController
  /** Content-hash revision of the last read/written copy; distinct from `editor.state.revision`
   *  (the in-memory undo counter). */
  documentRevision: string | null
  saving: boolean
  loadError: string | null
  conflict: WorkflowFileConflictReason | null
  /** True from `openDraft` until `saveDraftAs` succeeds (US6 AS2): the definition exists only in
   *  the editor, never written to disk. */
  isDraft: boolean
  open: (ref: OpenWorkflowRef) => Promise<void>
  createNew: (name: string, source: WorkflowRunSource) => Promise<void>
  /** Loads an agent-drafted definition (`workflow.draft`) straight into the editor as an unsaved
   *  draft — no `workflow.write` until `saveDraftAs`. */
  openDraft: (definition: Workflow) => void
  save: () => Promise<void>
  /** First save of an open draft: names it, writes it, and clears `isDraft`. Rethrows on failure
   *  (e.g. a taken name) so the naming dialog can show the error and the draft stays open. */
  saveDraftAs: (name: string, source: WorkflowRunSource) => Promise<void>
  reloadFromDisk: () => Promise<void>
  overwriteOnDisk: () => Promise<void>
  dismissConflict: () => void
  close: () => void
  /** Re-reads the open file and, if it moved since our last known revision, either adopts it
   *  silently (no local edits at risk) or raises the conflict dialog (edits would be lost). */
  checkForExternalChange: () => Promise<void>
}
