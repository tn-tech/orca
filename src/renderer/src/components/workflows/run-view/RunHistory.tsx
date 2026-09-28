import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import {
  workflowRunList,
  workflowRunRerun,
  workflowRunShow,
  type RuntimeWorkflowSettings,
  type WorkflowRunSnapshotView
} from '@/runtime/runtime-workflow-client'
import type { WorkflowAttemptState } from '../../../../../shared/workflows/workflow-node-states'
import type {
  RunSummary,
  WorkflowRunSource
} from '../../../../../shared/workflows/workflow-run-types'
import AttemptStateBadge from './AttemptStateBadge'
import { runStateLabel } from './RunToolbar'
import { nodeAttemptStatuses } from './use-workflow-run-snapshot'

export type RunHistoryProps = {
  settings: RuntimeWorkflowSettings
  repoId: string
  name: string
  source: WorkflowRunSource
  /** Highlights the run currently shown in the run view, if any. */
  currentRunId?: string | null
  /** "Open" a row, or the run a rerun just created — both hand off to the same run view. */
  onOpenRun: (runId: string) => void
}

/** `undefined` while still running (elapsed-so-far isn't "the duration" yet — review would confuse
 *  an in-progress run's growing number with a settled one). Raw unit letters, not translated,
 *  matches StatsPane's existing duration formatting. */
function formatRunDuration(
  startedAt: string | undefined,
  finishedAt: string | undefined
): string | undefined {
  if (!startedAt || !finishedAt) {
    return undefined
  }
  const start = new Date(startedAt).getTime()
  const end = new Date(finishedAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return undefined
  }
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return `${seconds}s`
  }
  const hours = Math.floor(minutes / 60)
  if (hours === 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${hours}h ${minutes % 60}m`
}

type RunDetailState = 'loading' | 'error' | WorkflowRunSnapshotView

/** A failed node's own row within an expanded, failed run — offers "Rerun from this node"
 *  (US8 AS2). The host still has the final say (draft-planner run, busy workspace, an attempt
 *  still active elsewhere); this only avoids offering the action when it plainly cannot apply. */
function NodeOutcomeRow({
  runId,
  runFailed,
  nodeId,
  title,
  state,
  onRerun,
  rerunning
}: {
  runId: string
  runFailed: boolean
  nodeId: string
  title: string
  state: WorkflowAttemptState
  onRerun: (runId: string, nodeId: string) => void
  rerunning: boolean
}): React.JSX.Element {
  return (
    <li className="flex items-center justify-between gap-2 py-1">
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{title}</span>
      <AttemptStateBadge state={state} />
      {runFailed && state === 'failed' ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={rerunning}
          onClick={() => onRerun(runId, nodeId)}
        >
          {rerunning ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          {translate(
            'auto.components.workflows.run-view.RunHistory.rerunFromNode',
            'Rerun from this node'
          )}
        </Button>
      ) : null}
    </li>
  )
}

/**
 * US8: past runs of the open workflow — outcome, duration, opening any of them into the run view,
 * and rerunning from a failed node. `workflow.run.list` has no `source` filter (rpc-methods.md), so
 * a same-named workflow under the other source is dropped client-side.
 */
export default function RunHistory({
  settings,
  repoId,
  name,
  source,
  currentRunId,
  onOpenRun
}: RunHistoryProps): React.JSX.Element {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, RunDetailState>>({})
  const [rerunningKey, setRerunningKey] = useState<string | null>(null)
  const [rerunError, setRerunError] = useState<string | undefined>()

  const fetchPage = useCallback(
    async (cursor: string | undefined) => {
      if (cursor) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }
      setError(undefined)
      try {
        const result = await workflowRunList(settings, {
          repo: repoId,
          name,
          ...(cursor ? { cursor } : {})
        })
        const ownSource = result.runs.filter((run) => run.workflowSource === source)
        setRuns((prev) => (cursor ? [...prev, ...ownSource] : ownSource))
        setNextCursor(result.nextCursor)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (cursor) {
          setLoadingMore(false)
        } else {
          setLoading(false)
        }
      }
    },
    [settings, repoId, name, source]
  )

  useEffect(() => {
    void fetchPage(undefined)
  }, [fetchPage])

  const toggleExpand = useCallback(
    (runId: string) => {
      if (expandedRunId === runId) {
        setExpandedRunId(null)
        return
      }
      setExpandedRunId(runId)
      if (details[runId]) {
        return
      }
      setDetails((prev) => ({ ...prev, [runId]: 'loading' }))
      workflowRunShow(settings, runId)
        .then((snapshot) => setDetails((prev) => ({ ...prev, [runId]: snapshot })))
        .catch(() => setDetails((prev) => ({ ...prev, [runId]: 'error' })))
    },
    [expandedRunId, details, settings]
  )

  const rerunFromNode = useCallback(
    (runId: string, nodeId: string) => {
      const key = `${runId}:${nodeId}`
      setRerunningKey(key)
      setRerunError(undefined)
      workflowRunRerun(settings, { runId, fromNodeId: nodeId })
        .then((result) => onOpenRun(result.runId))
        .catch((err: unknown) => {
          if (hasRuntimeRpcErrorCode(err, 'method_not_found')) {
            setRerunError(
              translate(
                'auto.components.workflows.run-view.RunHistory.rerunNotImplemented',
                "Rerunning isn't available on this host yet."
              )
            )
            return
          }
          setRerunError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => setRerunningKey((current) => (current === key ? null : current)))
    },
    [settings, onOpenRun]
  )

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {translate('auto.components.workflows.run-view.RunHistory.loading', 'Loading run history…')}
      </div>
    )
  }

  if (error) {
    return (
      <p className="p-4 text-xs text-destructive" role="alert">
        {error}
      </p>
    )
  }

  if (runs.length === 0) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {translate('auto.components.workflows.run-view.RunHistory.empty', 'No runs yet.')}
      </p>
    )
  }

  return (
    <div className="scrollbar-sleek max-h-[60vh] overflow-y-auto">
      {rerunError ? (
        <p className="px-3 pt-2 text-xs text-destructive" role="alert">
          {rerunError}
        </p>
      ) : null}
      <ul>
        {runs.map((run) => {
          const detail = details[run.id]
          const expanded = expandedRunId === run.id
          const duration = formatRunDuration(run.startedAt, run.finishedAt)
          return (
            <li key={run.id} className="border-b border-border px-3 py-2 last:border-b-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex shrink-0 items-center text-muted-foreground"
                  aria-label={translate(
                    'auto.components.workflows.run-view.RunHistory.details',
                    'Details'
                  )}
                  onClick={() => toggleExpand(run.id)}
                >
                  {expanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                </button>
                <span
                  className="min-w-0 flex-1 truncate text-xs"
                  data-current={run.id === currentRunId || undefined}
                >
                  <span className="text-foreground">{runStateLabel(run.state)}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-muted-foreground">
                    {formatUiRelativeTimeFromDate(run.startedAt ?? run.createdAt)}
                  </span>
                  {duration ? (
                    <>
                      <span className="text-muted-foreground"> · </span>
                      <span className="text-muted-foreground">{duration}</span>
                    </>
                  ) : null}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenRun(run.id)}>
                  {translate('auto.components.workflows.run-view.RunHistory.open', 'Open')}
                </Button>
              </div>
              {expanded ? (
                <div className="mt-2 pl-6">
                  {detail === 'loading' || detail === undefined ? (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  ) : detail === 'error' ? (
                    <p className="text-xs text-destructive">
                      {translate(
                        'auto.components.workflows.run-view.RunHistory.detailError',
                        "Couldn't load this run's details."
                      )}
                    </p>
                  ) : (
                    <ul>
                      {detail.workflowSnapshot.nodes.map((node) => {
                        const state = nodeAttemptStatuses(detail)[node.id]
                        if (!state) {
                          return null
                        }
                        return (
                          <NodeOutcomeRow
                            key={node.id}
                            runId={run.id}
                            runFailed={detail.state === 'failed'}
                            nodeId={node.id}
                            title={node.title}
                            state={state}
                            onRerun={rerunFromNode}
                            rerunning={rerunningKey === `${run.id}:${node.id}`}
                          />
                        )
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {nextCursor ? (
        <div className="p-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void fetchPage(nextCursor)}
          >
            {loadingMore ? <Loader2 className="animate-spin" /> : null}
            {translate('auto.components.workflows.run-view.RunHistory.loadMore', 'Load more')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
