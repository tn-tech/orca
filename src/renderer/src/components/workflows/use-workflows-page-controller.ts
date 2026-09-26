import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { useActiveRepo, useActiveWorktree } from '@/store/selectors'
import {
  workflowDelete,
  workflowDuplicate,
  workflowValidate
} from '@/runtime/runtime-workflow-client'
import type { Node, WorkflowProblem } from '../../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunSource } from '../../../../shared/workflows/workflow-run-types'
import { validateWorkflowGraph } from '../../../../shared/workflows/workflow-graph-validation'
import { createLocalGraphValidationContext } from './editor/workflow-graph-validation-context'
import {
  hasBlockingWorkflowProblems,
  mergeWorkflowValidationProblems
} from './editor/workflow-validation-merge'
import { useWorkflowEditorSession } from './use-workflow-editor-session'
import { useWorkflowExternalChangeWatch } from './use-workflow-external-change-watch'
import { useWorkflowListState } from './use-workflow-list-state'
import type { WorkflowSummary } from '@/runtime/runtime-workflow-client'

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
    const timer = window.setTimeout(() => {
      void workflowValidate(settings, { repo: repoId, definition })
        .then((result) => setHostProblems(result.problems))
        .catch(() => {
          // Best-effort: local validation still surfaces structural problems while offline/racing.
        })
    }, HOST_VALIDATE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [definition, repoId, settings])

  const problems = useMemo(
    () => mergeWorkflowValidationProblems(localProblems, hostProblems),
    [localProblems, hostProblems]
  )
  const canRun = session.status === 'ready' && !hasBlockingWorkflowProblems(problems)

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
      void session.open({ name: row.name, source: row.source })
    },
    [session]
  )

  const createWorkflow = useCallback(
    async (name: string, source: WorkflowRunSource) => {
      setSelectedNodeId(undefined)
      setSelectedEdgeId(undefined)
      await session.createNew(name, source)
      await list.refresh()
    },
    [list, session]
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
      await session.open({ name: result.name, source: row.source })
    },
    [list, repoId, session, settings]
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
      }
      await list.refresh()
    },
    [list, repoId, session, settings]
  )

  return {
    activeRepo,
    list,
    session,
    problems,
    canRun,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNodeId,
    setSelectedEdgeId,
    focusProblem,
    openWorkflow,
    createWorkflow,
    duplicateWorkflow,
    deleteWorkflow
  }
}

export type WorkflowsPageController = ReturnType<typeof useWorkflowsPageController>
