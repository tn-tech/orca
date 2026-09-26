import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useActiveRepo, useActiveWorktree } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import {
  workflowDelete,
  workflowDuplicate,
  workflowRunCancel,
  workflowRunStart,
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
import { useWorkflowRunSnapshot } from './run-view/use-workflow-run-snapshot'
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
  const canRun = session.status === 'ready' && !hasBlockingWorkflowProblems(problems)

  // Why scoped to `activeRunId`: a run belongs to the workflow it started against, so switching
  // the open workflow (below) drops it rather than showing a stale run for the newly opened file.
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [runStarting, setRunStarting] = useState(false)
  const [runStopping, setRunStopping] = useState(false)
  const runSnapshot = useWorkflowRunSnapshot({ settings, runId: activeRunId })

  const startRun = useCallback(
    async (objective: string) => {
      if (!repoId || !session.openRef) {
        return
      }
      setRunStarting(true)
      try {
        const result = await workflowRunStart(settings, {
          repo: repoId,
          name: session.openRef.name,
          source: session.openRef.source,
          objective
        })
        setActiveRunId(result.runId)
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.workflows.use-workflows-page-controller.runStartFailed',
                'Failed to start the run.'
              )
        )
      } finally {
        setRunStarting(false)
      }
    },
    [repoId, session.openRef, settings]
  )

  const stopRun = useCallback(async () => {
    if (!activeRunId) {
      return
    }
    setRunStopping(true)
    try {
      await workflowRunCancel(settings, activeRunId)
    } catch (error) {
      // Why not surfaced as an error: `workflow.run.cancel` is a host stub today (US8); this is
      // an expected, temporary gap rather than a failure the user needs to retry or report.
      if (hasRuntimeRpcErrorCode(error, 'workflow_not_implemented')) {
        toast.message(
          translate(
            'auto.components.workflows.use-workflows-page-controller.runStopNotImplemented',
            "Stopping a run isn't available yet."
          )
        )
        return
      }
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.workflows.use-workflows-page-controller.runStopFailed',
              'Failed to stop the run.'
            )
      )
    } finally {
      setRunStopping(false)
    }
  }, [activeRunId, settings])

  const run = useMemo(
    () => ({
      runId: activeRunId,
      snapshot: runSnapshot.snapshot,
      starting: runStarting,
      stopping: runStopping,
      start: startRun,
      stop: stopRun
    }),
    [activeRunId, runSnapshot.snapshot, runStarting, runStopping, startRun, stopRun]
  )

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
      setActiveRunId(null)
      void session.open({ name: row.name, source: row.source })
    },
    [session]
  )

  const createWorkflow = useCallback(
    async (name: string, source: WorkflowRunSource) => {
      setSelectedNodeId(undefined)
      setSelectedEdgeId(undefined)
      setActiveRunId(null)
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
      setActiveRunId(null)
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
        setActiveRunId(null)
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
    run,
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
