import { useCallback, useMemo, useState } from 'react'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import {
  workflowRead,
  workflowWrite,
  type RuntimeWorkflowSettings
} from '@/runtime/runtime-workflow-client'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunSource } from '../../../../shared/workflows/workflow-run-types'
import {
  useWorkflowEditorState,
  type WorkflowEditorController
} from './editor/use-workflow-editor-state'
import type { WorkflowFileConflictReason } from './editor/FileConflictDialog'

export type OpenWorkflowRef = { name: string; source: WorkflowRunSource }

export type WorkflowEditorSessionStatus = 'empty' | 'loading' | 'ready' | 'error'

function placeholderWorkflowDefinition(): Workflow {
  return {
    version: 1,
    name: '',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [],
    edges: [],
    layout: {}
  }
}

/** A fresh workflow's starting graph: Start → End, already reachable (FR-002/graph_missing_*). */
function newWorkflowDefinition(name: string): Workflow {
  return {
    version: 1,
    name,
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [{ id: `edge-${createBrowserUuid()}`, from: 'start', to: 'end' }],
    layout: { start: { x: 0, y: 0 }, end: { x: 320, y: 0 } }
  }
}

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
  open: (ref: OpenWorkflowRef) => Promise<void>
  createNew: (name: string, source: WorkflowRunSource) => Promise<void>
  save: () => Promise<void>
  reloadFromDisk: () => Promise<void>
  overwriteOnDisk: () => Promise<void>
  dismissConflict: () => void
  close: () => void
  /** Re-reads the open file and, if it moved since our last known revision, either adopts it
   *  silently (no local edits at risk) or raises the conflict dialog (edits would be lost). */
  checkForExternalChange: () => Promise<void>
}

export type UseWorkflowEditorSessionParams = {
  settings: RuntimeWorkflowSettings
  repoId: string | undefined
}

export function useWorkflowEditorSession({
  settings,
  repoId
}: UseWorkflowEditorSessionParams): WorkflowEditorSession {
  const placeholder = useMemo(() => placeholderWorkflowDefinition(), [])
  const editor = useWorkflowEditorState(placeholder)
  const [status, setStatus] = useState<WorkflowEditorSessionStatus>('empty')
  const [openRef, setOpenRef] = useState<OpenWorkflowRef | null>(null)
  const [documentRevision, setDocumentRevision] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<WorkflowFileConflictReason | null>(null)

  const open = useCallback(
    async (ref: OpenWorkflowRef) => {
      if (!repoId) {
        return
      }
      setStatus('loading')
      setLoadError(null)
      setConflict(null)
      try {
        const result = await workflowRead(settings, { repo: repoId, ...ref })
        if (!result.definition) {
          setStatus('error')
          setLoadError(
            result.problems[0]?.message ??
              'auto.components.workflows.use-workflow-editor-session.unreadable'
          )
          return
        }
        editor.dispatch({ type: 'load-definition', definition: result.definition })
        setOpenRef(ref)
        setDocumentRevision(result.revision)
        setStatus('ready')
      } catch (error) {
        setStatus('error')
        setLoadError(error instanceof Error ? error.message : String(error))
      }
    },
    [editor, repoId, settings]
  )

  const createNew = useCallback(
    async (name: string, source: WorkflowRunSource) => {
      if (!repoId) {
        return
      }
      setStatus('loading')
      setLoadError(null)
      setConflict(null)
      const definition = newWorkflowDefinition(name)
      try {
        const result = await workflowWrite(settings, { repo: repoId, name, source, definition })
        editor.dispatch({ type: 'load-definition', definition })
        setOpenRef({ name, source })
        setDocumentRevision(result.revision)
        setStatus('ready')
      } catch (error) {
        setStatus('error')
        setLoadError(error instanceof Error ? error.message : String(error))
        throw error
      }
    },
    [editor, repoId, settings]
  )

  const save = useCallback(async () => {
    if (!repoId || !openRef || status !== 'ready') {
      return
    }
    setSaving(true)
    try {
      const result = await workflowWrite(settings, {
        repo: repoId,
        name: openRef.name,
        source: openRef.source,
        definition: editor.state.definition,
        expectedRevision: documentRevision ?? undefined
      })
      setDocumentRevision(result.revision)
      editor.dispatch({ type: 'mark-saved' })
    } catch (error) {
      if (hasRuntimeRpcErrorCode(error, 'workflow_file_conflict')) {
        setConflict('save')
        return
      }
      throw error
    } finally {
      setSaving(false)
    }
  }, [documentRevision, editor, openRef, repoId, settings, status])

  const reloadFromDisk = useCallback(async () => {
    if (!repoId || !openRef) {
      return
    }
    const result = await workflowRead(settings, { repo: repoId, ...openRef })
    if (result.definition) {
      editor.dispatch({ type: 'load-definition', definition: result.definition })
      setDocumentRevision(result.revision)
    }
    setConflict(null)
  }, [editor, openRef, repoId, settings])

  const overwriteOnDisk = useCallback(async () => {
    if (!repoId || !openRef) {
      return
    }
    setSaving(true)
    try {
      const current = await workflowRead(settings, { repo: repoId, ...openRef })
      const result = await workflowWrite(settings, {
        repo: repoId,
        name: openRef.name,
        source: openRef.source,
        definition: editor.state.definition,
        expectedRevision: current.revision
      })
      setDocumentRevision(result.revision)
      editor.dispatch({ type: 'mark-saved' })
      setConflict(null)
    } catch (error) {
      if (hasRuntimeRpcErrorCode(error, 'workflow_file_conflict')) {
        // Why: raced again against a second concurrent writer; ask the user again rather than loop.
        setConflict('save')
        return
      }
      throw error
    } finally {
      setSaving(false)
    }
  }, [editor, openRef, repoId, settings])

  const dismissConflict = useCallback(() => setConflict(null), [])

  const close = useCallback(() => {
    editor.dispatch({ type: 'load-definition', definition: placeholderWorkflowDefinition() })
    setOpenRef(null)
    setDocumentRevision(null)
    setStatus('empty')
    setLoadError(null)
    setConflict(null)
  }, [editor])

  const checkForExternalChange = useCallback(async () => {
    if (!repoId || !openRef || status !== 'ready' || conflict) {
      return
    }
    try {
      const result = await workflowRead(settings, { repo: repoId, ...openRef })
      if (!result.definition || result.revision === documentRevision) {
        return
      }
      if (editor.state.dirty) {
        setConflict('external')
        return
      }
      editor.dispatch({ type: 'load-definition', definition: result.definition })
      setDocumentRevision(result.revision)
    } catch {
      // Best-effort: a transient read failure here just skips this poll.
    }
  }, [conflict, documentRevision, editor, openRef, repoId, settings, status])

  return {
    status,
    openRef,
    editor,
    documentRevision,
    saving,
    loadError,
    conflict,
    open,
    createNew,
    save,
    reloadFromDisk,
    overwriteOnDisk,
    dismissConflict,
    close,
    checkForExternalChange
  }
}
