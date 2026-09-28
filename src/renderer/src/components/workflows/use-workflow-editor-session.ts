import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import { noActiveProjectReason } from './workflow-no-active-project-reason'
import {
  workflowRead,
  workflowWrite,
  type RuntimeWorkflowSettings
} from '@/runtime/runtime-workflow-client'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunSource } from '../../../../shared/workflows/workflow-run-types'
import { useWorkflowEditorState } from './editor/use-workflow-editor-state'
import type { WorkflowFileConflictReason } from './editor/FileConflictDialog'
import {
  newWorkflowDefinition,
  placeholderWorkflowDefinition
} from './workflow-editor-starter-definitions'
import type {
  OpenWorkflowRef,
  WorkflowEditorSession,
  WorkflowEditorSessionStatus
} from './workflow-editor-session-types'

export type {
  OpenWorkflowRef,
  WorkflowEditorSession,
  WorkflowEditorSessionStatus
} from './workflow-editor-session-types'

export type UseWorkflowEditorSessionParams = {
  settings: RuntimeWorkflowSettings
  repoId: string | undefined
}

function errorOrFallback(error: unknown, key: string, fallback: string): string {
  return error instanceof Error ? error.message : translate(key, fallback)
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
  const [isDraft, setIsDraft] = useState(false)

  const open = useCallback(
    async (ref: OpenWorkflowRef) => {
      if (!repoId) {
        setStatus('error')
        setLoadError(noActiveProjectReason())
        return
      }
      setStatus('loading')
      setLoadError(null)
      setConflict(null)
      setIsDraft(false)
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
        // F6: throw, not a silent return — WorkflowNameDialog's catch shows this.
        throw new Error(noActiveProjectReason())
      }
      setStatus('loading')
      setLoadError(null)
      setConflict(null)
      setIsDraft(false)
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

  const openDraft = useCallback(
    (definition: Workflow) => {
      editor.dispatch({ type: 'load-definition', definition })
      setOpenRef(null)
      setDocumentRevision(null)
      setIsDraft(true)
      setLoadError(null)
      setConflict(null)
      setStatus('ready')
    },
    [editor]
  )

  const saveDraftAs = useCallback(
    async (name: string, source: WorkflowRunSource) => {
      if (!repoId) {
        // F6: throw, not a silent return — the save-draft dialog's catch shows this.
        throw new Error(noActiveProjectReason())
      }
      setSaving(true)
      try {
        const definition: Workflow = { ...editor.state.definition, name }
        const result = await workflowWrite(settings, { repo: repoId, name, source, definition })
        editor.dispatch({ type: 'load-definition', definition })
        setOpenRef({ name, source })
        setDocumentRevision(result.revision)
        setIsDraft(false)
      } finally {
        setSaving(false)
      }
    },
    [editor, repoId, settings]
  )

  const save = useCallback(async () => {
    if (!repoId) {
      // F6: same toast path as a failed write below — the project can drop out mid-session.
      toast.error(noActiveProjectReason())
      return
    }
    if (!openRef || status !== 'ready') {
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
      toast.error(
        errorOrFallback(
          error,
          'auto.components.workflows.use-workflow-editor-session.saveFailed',
          'Failed to save workflow.'
        )
      )
    } finally {
      setSaving(false)
    }
  }, [documentRevision, editor, openRef, repoId, settings, status])

  const reloadFromDisk = useCallback(async () => {
    if (!repoId) {
      toast.error(noActiveProjectReason()) // F6: same toast path as a failed read below.
      return
    }
    if (!openRef) {
      return
    }
    try {
      const result = await workflowRead(settings, { repo: repoId, ...openRef })
      if (result.definition) {
        editor.dispatch({ type: 'load-definition', definition: result.definition })
        setDocumentRevision(result.revision)
      }
      setConflict(null)
    } catch (error) {
      toast.error(
        errorOrFallback(
          error,
          'auto.components.workflows.use-workflow-editor-session.reloadFailed',
          'Failed to reload the workflow from disk.'
        )
      )
    }
  }, [editor, openRef, repoId, settings])

  const overwriteOnDisk = useCallback(async () => {
    if (!repoId) {
      toast.error(noActiveProjectReason()) // F6: same toast path as a failed write below.
      return
    }
    if (!openRef) {
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
        setConflict('save') // Raced again — ask the user again rather than retry-looping.
        return
      }
      toast.error(
        errorOrFallback(
          error,
          'auto.components.workflows.use-workflow-editor-session.overwriteFailed',
          'Failed to overwrite the workflow on disk.'
        )
      )
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
    setIsDraft(false)
  }, [editor])

  const checkForExternalChange = useCallback(async () => {
    if (!repoId || !openRef || status !== 'ready' || conflict || saving) {
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
  }, [conflict, documentRevision, editor, openRef, repoId, saving, settings, status])

  return {
    status,
    openRef,
    editor,
    documentRevision,
    saving,
    loadError,
    conflict,
    isDraft,
    open,
    createNew,
    openDraft,
    save,
    saveDraftAs,
    reloadFromDisk,
    overwriteOnDisk,
    dismissConflict,
    close,
    checkForExternalChange
  }
}
