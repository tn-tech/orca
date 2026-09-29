import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useActiveRepo, useActiveWorktree } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { noActiveProjectReason as getNoActiveProjectReason } from './workflow-no-active-project-reason'
import {
  workflowDelete,
  workflowDraft,
  workflowDuplicate,
  type WorkflowDraftResult,
  type WorkflowSummary
} from '@/runtime/runtime-workflow-client'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunSource } from '../../../../shared/workflows/workflow-run-types'
import { validateWorkflowGraph } from '../../../../shared/workflows/workflow-graph-validation'
import { checkWorkflowFields } from './editor/workflow-field-problems'
import { createLocalGraphValidationContext } from './editor/workflow-graph-validation-context'
import {
  hasBlockingWorkflowProblems,
  mergeWorkflowValidationProblems,
  SKILL_SOURCE_NOT_ALLOWLISTED_CODE
} from './editor/workflow-validation-merge'
import {
  createDefaultNode,
  freeNodePosition,
  type AddableNodeKind
} from './editor/workflow-new-node-defaults'
import { useWorkflowEditorMutations } from './use-workflow-editor-mutations'
import { useWorkflowEditorSession } from './use-workflow-editor-session'
import { useWorkflowExternalChangeWatch } from './use-workflow-external-change-watch'
import { useWorkflowHostValidation } from './use-workflow-host-validation'
import { useWorkflowListState } from './use-workflow-list-state'
import { useWorkflowProblemFocus } from './use-workflow-problem-focus'
import { useWorkflowSourceAllowlist } from './use-workflow-source-allowlist'
import { useWorkflowPageResume } from './use-workflow-page-resume'
import { useWorkflowRunControls } from './use-workflow-run-controls'

export function useWorkflowsPageController() {
  const settings = useAppStore((s) => s.settings)
  const activeRepo = useActiveRepo()
  const activeWorktree = useActiveWorktree()
  const repoId = activeRepo?.id

  const list = useWorkflowListState(settings, repoId)
  const session = useWorkflowEditorSession({ settings, repoId })
  const allowlistedSources = useWorkflowSourceAllowlist(settings, repoId)

  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>()
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>()

  const localValidationContext = useMemo(() => createLocalGraphValidationContext(), [])
  const definition = session.status === 'ready' ? session.editor.state.definition : null

  // F7: schema-level field problems first (they block Save), then the graph rules (Run only).
  const fieldCheck = useMemo(
    () => (definition ? checkWorkflowFields(definition) : null),
    [definition]
  )
  const localProblems = useMemo(
    () =>
      definition
        ? [
            ...(fieldCheck?.problems ?? []),
            ...validateWorkflowGraph(definition, localValidationContext)
          ]
        : [],
    [definition, fieldCheck, localValidationContext]
  )
  const hasInvalidFields = fieldCheck !== null && !fieldCheck.storable
  const hostProblems = useWorkflowHostValidation({
    settings,
    repoId,
    definition,
    storable: !hasInvalidFields
  })

  const problems = useMemo(
    () => mergeWorkflowValidationProblems(localProblems, hostProblems),
    [localProblems, hostProblems]
  )
  // F6: the active project can drop out from under a still-'ready' session (the user switches
  // away from it mid-edit); without this, Run stays clickable and startRun's own `!repoId` guard
  // just no-ops silently.
  const noActiveProjectReason = repoId ? undefined : getNoActiveProjectReason()
  const blockingProblems = hasBlockingWorkflowProblems(problems)
  // `workflow.write` refuses these outright (workflow-definition-save.ts), unlike other graph errors.
  const hasDisallowedSources = problems.some(
    (problem) => problem.code === SKILL_SOURCE_NOT_ALLOWLISTED_CODE
  )
  // US6 AS2: an unsaved draft has no file to run against yet — save it first.
  const canRun =
    Boolean(repoId) && session.status === 'ready' && !session.isDraft && !blockingProblems
  // F6: mirrors the reason WorkflowsPage's RunToolbar already shows (draft, then blocking
  // problems) with the no-project reason taking priority — nothing else matters without one.
  const runDisabledReason = noActiveProjectReason
    ? noActiveProjectReason
    : session.isDraft
      ? translate(
          'auto.components.workflows.WorkflowsPage.runBlockedDraft',
          'Save this draft before running it.'
        )
      : blockingProblems
        ? translate(
            'auto.components.workflows.WorkflowsPage.runBlockedProblems',
            'Fix the problems below before running.'
          )
        : undefined

  const { run, clearActiveRun } = useWorkflowRunControls({
    settings,
    repoId,
    openRef: session.openRef
  })

  useWorkflowPageResume({
    repoId,
    openRef: session.openRef,
    runId: run.runId,
    runLoadFailed: run.loadFailed,
    open: session.open,
    openRun: run.openRun,
    dropRun: clearActiveRun
  })

  const focusProblem = useWorkflowProblemFocus({ definition, setSelectedNodeId, setSelectedEdgeId })

  useWorkflowExternalChangeWatch({
    enabled: session.status === 'ready' && session.openRef?.source === 'project',
    settings,
    worktreeId: activeWorktree?.id ?? null,
    worktreePath: activeWorktree?.path ?? null,
    onChange: session.checkForExternalChange
  })

  const openWorkflow = useCallback(
    (row: WorkflowSummary) => {
      setSelectedNodeId(undefined)
      setSelectedEdgeId(undefined)
      clearActiveRun()
      void session.open({ name: row.name, source: row.source })
    },
    [clearActiveRun, session]
  )

  const createWorkflow = useCallback(
    async (name: string, source: WorkflowRunSource) => {
      setSelectedNodeId(undefined)
      setSelectedEdgeId(undefined)
      clearActiveRun()
      await session.createNew(name, source)
      await list.refresh()
    },
    [clearActiveRun, list, session]
  )

  const duplicateWorkflow = useCallback(
    async (row: WorkflowSummary, newName: string) => {
      if (!repoId) {
        // F6: throw, not a silent return — reuses WorkflowNameDialog's own catch (same dialog as
        // "New workflow"), so this can't close as if the duplicate were created.
        throw new Error(getNoActiveProjectReason())
      }
      const result = await workflowDuplicate(settings, {
        repo: repoId,
        name: row.name,
        source: row.source,
        newName
      })
      await list.refresh()
      setSelectedNodeId(undefined)
      setSelectedEdgeId(undefined)
      clearActiveRun()
      await session.open({ name: result.name, source: row.source })
    },
    [clearActiveRun, list, repoId, session, settings]
  )

  // A deselect must not clear an edge selected in the same batch (keyboard node -> edge).
  const selectNode = useCallback((nodeId: string | undefined) => {
    setSelectedNodeId(nodeId)
    if (nodeId) {
      setSelectedEdgeId(undefined)
    }
  }, [])

  /** Calls `workflow.draft` (US6 AS1) — does not touch the editor session; see `openDraft`. */
  const draftWorkflow = useCallback(
    (objective: string): Promise<WorkflowDraftResult> => {
      if (!repoId) {
        return Promise.reject(
          new Error(
            translate(
              'auto.components.workflows.use-workflows-page-controller.draftNoRepo',
              'No active repository.'
            )
          )
        )
      }
      return workflowDraft(settings, { repo: repoId, objective })
    },
    [repoId, settings]
  )

  /** Loads a drafted definition into the editor, unsaved, until `saveDraft` (US6 AS2). */
  const openDraft = useCallback(
    (definition: Workflow) => {
      setSelectedNodeId(undefined)
      setSelectedEdgeId(undefined)
      clearActiveRun()
      session.openDraft(definition)
    },
    [clearActiveRun, session]
  )

  /** First save of an open draft (US6 AS2): writes it, then refreshes the list — unlike `open`,
   *  the list has no row for a draft yet, and it only reloads on mount/repo-change/an explicit
   *  refresh, so skipping this would leave the newly-saved workflow missing from the pane. Rethrows
   *  (from `session.saveDraftAs`) on failure, so the naming dialog can show the error and no refresh
   *  happens for a save that didn't land. */
  const saveDraft = useCallback(
    async (name: string, source: WorkflowRunSource) => {
      await session.saveDraftAs(name, source)
      await list.refresh()
    },
    [list, session]
  )

  /** U63 "Add node" menu: creates `kind` with sensible defaults, appends it below the existing
   *  layout (never on top of another node), and selects it so `NodeInspector` opens on it. */
  const addNode = useCallback(
    (kind: AddableNodeKind) => {
      if (session.status !== 'ready') {
        return
      }
      const node = createDefaultNode(kind)
      const position = freeNodePosition(
        session.editor.state.definition.nodes,
        session.editor.state.definition.layout
      )
      session.editor.dispatch({ type: 'add-node', node, position })
      setSelectedNodeId(node.id)
      setSelectedEdgeId(undefined)
    },
    [session]
  )

  const deleteWorkflow = useCallback(
    async (row: WorkflowSummary) => {
      if (!repoId) {
        // F6: WorkflowDeleteDialog has no catch of its own, so surface this via toast — the same
        // pattern the session uses for its own fire-and-forget, `void`-called actions.
        toast.error(getNoActiveProjectReason())
        return
      }
      await workflowDelete(settings, { repo: repoId, name: row.name, source: row.source })
      if (session.openRef?.name === row.name && session.openRef.source === row.source) {
        session.close()
        setSelectedNodeId(undefined)
        setSelectedEdgeId(undefined)
        clearActiveRun()
      }
      await list.refresh()
    },
    [clearActiveRun, list, repoId, session, settings]
  )

  const editorMutations = useWorkflowEditorMutations({
    session,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNodeId,
    setSelectedEdgeId
  })

  return {
    activeRepo,
    repoId,
    settings,
    allowlistedSources,
    list,
    session,
    problems,
    hasInvalidFields,
    hasDisallowedSources,
    canRun,
    noActiveProjectReason,
    runDisabledReason,
    run,
    backToEditing: clearActiveRun,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNodeId,
    setSelectedEdgeId,
    selectNode,
    focusProblem,
    openWorkflow,
    createWorkflow,
    duplicateWorkflow,
    addNode,
    deleteWorkflow,
    draftWorkflow,
    openDraft,
    saveDraft,
    ...editorMutations
  }
}

export type WorkflowsPageController = ReturnType<typeof useWorkflowsPageController>
