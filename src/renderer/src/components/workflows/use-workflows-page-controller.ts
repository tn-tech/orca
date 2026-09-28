import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { useActiveRepo, useActiveWorktree } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import {
  workflowDelete,
  workflowDraft,
  workflowDuplicate,
  workflowValidate,
  type WorkflowDraftResult,
  type WorkflowSummary
} from '@/runtime/runtime-workflow-client'
import type {
  Node,
  Workflow,
  WorkflowProblem
} from '../../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunSource } from '../../../../shared/workflows/workflow-run-types'
import { validateWorkflowGraph } from '../../../../shared/workflows/workflow-graph-validation'
import { createLocalGraphValidationContext } from './editor/workflow-graph-validation-context'
import {
  hasBlockingWorkflowProblems,
  mergeWorkflowValidationProblems
} from './editor/workflow-validation-merge'
import {
  createDefaultNode,
  freeNodePosition,
  type AddableNodeKind
} from './editor/workflow-new-node-defaults'
import { useWorkflowEditorSession } from './use-workflow-editor-session'
import { useWorkflowExternalChangeWatch } from './use-workflow-external-change-watch'
import { useWorkflowListState } from './use-workflow-list-state'
import { useWorkflowSourceAllowlist } from './use-workflow-source-allowlist'
import { useWorkflowRunControls } from './use-workflow-run-controls'

const HOST_VALIDATE_DEBOUNCE_MS = 400

/** Only Agent/Router/Reflection nodes dispatch through a role (workflow-graph-validation.ts). */
function nodeRoleId(node: Node): string | undefined {
  return node.type === 'agent' || node.type === 'router' || node.type === 'reflection'
    ? node.roleId
    : undefined
}

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
  const [hostProblems, setHostProblems] = useState<WorkflowProblem[]>([])

  const localValidationContext = useMemo(() => createLocalGraphValidationContext(), [])
  const definition = session.status === 'ready' ? session.editor.state.definition : null

  const localProblems = useMemo(
    () => (definition ? validateWorkflowGraph(definition, localValidationContext) : []),
    [definition, localValidationContext]
  )

  // Debounced host re-validation (FR-009): the authoritative check for anything the renderer
  // can't verify on its own (e.g. the project's skill-source allowlist).
  useEffect(() => {
    if (!definition || !repoId) {
      setHostProblems([])
      return
    }
    // Why: a slower, earlier request (a stale definition, or a workflow the user has since
    // switched away from) must never overwrite a later one's result once it finally resolves.
    let ignore = false
    const timer = window.setTimeout(() => {
      void workflowValidate(settings, { repo: repoId, definition })
        .then((result) => {
          if (!ignore) {
            setHostProblems(result.problems)
          }
        })
        .catch(() => {
          // Best-effort: local validation still surfaces structural problems while offline/racing.
        })
    }, HOST_VALIDATE_DEBOUNCE_MS)
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [definition, repoId, settings])

  const problems = useMemo(
    () => mergeWorkflowValidationProblems(localProblems, hostProblems),
    [localProblems, hostProblems]
  )
  // US6 AS2: an unsaved draft has no file to run against yet — save it first.
  const canRun =
    session.status === 'ready' && !session.isDraft && !hasBlockingWorkflowProblems(problems)

  const { run, clearActiveRun } = useWorkflowRunControls({
    settings,
    repoId,
    openRef: session.openRef
  })

  const focusProblem = useCallback(
    (problem: WorkflowProblem) => {
      if (problem.nodeId) {
        setSelectedNodeId(problem.nodeId)
        setSelectedEdgeId(undefined)
        return
      }
      if (problem.edgeId) {
        setSelectedEdgeId(problem.edgeId)
        setSelectedNodeId(undefined)
        return
      }
      if (problem.roleId && definition) {
        const node = definition.nodes.find((candidate) => nodeRoleId(candidate) === problem.roleId)
        if (node) {
          setSelectedNodeId(node.id)
          setSelectedEdgeId(undefined)
        }
      }
    },
    [definition]
  )

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
        return
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

  return {
    activeRepo,
    repoId,
    settings,
    allowlistedSources,
    list,
    session,
    problems,
    canRun,
    run,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNodeId,
    setSelectedEdgeId,
    focusProblem,
    openWorkflow,
    createWorkflow,
    duplicateWorkflow,
    addNode,
    deleteWorkflow,
    draftWorkflow,
    openDraft,
    saveDraft
  }
}

export type WorkflowsPageController = ReturnType<typeof useWorkflowsPageController>
