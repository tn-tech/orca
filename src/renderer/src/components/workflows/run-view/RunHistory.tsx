import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { cn } from '@/lib/utils'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import {
  workflowRunList,
  workflowRunRerun,
  workflowRunShow,
  type RuntimeWorkflowSettings,
  type WorkflowRunSnapshotView
} from '@/runtime/runtime-workflow-client'
import type {
  RunSummary,
  WorkflowRunSource
} from '../../../../../shared/workflows/workflow-run-types'
import { runStateLabel } from './RunToolbar'
import { formatRunDuration } from './run-history-duration'
import NodeOutcomeRow, { loopBodyNodeIds, rerunRefusalMessage } from './RunHistoryNodeOutcomeRow'
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

type RunDetailState = 'loading' | 'error' | WorkflowRunSnapshotView

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
  const [rerunError, setRerunError] = useState<{ key: string; message: string } | undefined>()

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
        if (hasRuntimeRpcErrorCode(err, 'method_not_found')) {
          setError(
            translate(
              'auto.components.workflows.run-view.RunHistory.listNotImplemented',
              "Run history isn't available on this host yet."
            )
          )
        } else {
          setError(err instanceof Error ? err.message : String(err))
        }
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

  const fetchDetail = useCallback(
    (runId: string) => {
      setDetails((prev) => ({ ...prev, [runId]: 'loading' }))
      workflowRunShow(settings, runId)
        .then((snapshot) => setDetails((prev) => ({ ...prev, [runId]: snapshot })))
        .catch(() => setDetails((prev) => ({ ...prev, [runId]: 'error' })))
    },
    [settings]
  )

  const toggleExpand = useCallback(
    (runId: string) => {
      if (expandedRunId === runId) {
        setExpandedRunId(null)
        return
      }
      setExpandedRunId(runId)
      // Re-fetches on retry (cached as 'error') but not a run already loaded successfully.
      if (details[runId] && details[runId] !== 'error') {
        return
      }
      fetchDetail(runId)
    },
    [expandedRunId, details, fetchDetail]
  )

  const rerunFromNode = useCallback(
    (runId: string, nodeId: string) => {
      const key = `${runId}:${nodeId}`
      setRerunningKey(key)
      setRerunError(undefined)
      workflowRunRerun(settings, { runId, fromNodeId: nodeId })
        .then((result) => onOpenRun(result.runId))
        .catch((err: unknown) => setRerunError({ key, message: rerunRefusalMessage(err) }))
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

  return (
    <div className="scrollbar-sleek max-h-[60vh] overflow-y-auto">
      {error ? (
        <div
          className="flex items-center justify-between gap-2 p-4 text-xs text-destructive"
          role="alert"
        >
          <span>{error}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void fetchPage(undefined)}>
            {translate('auto.components.workflows.run-view.RunHistory.retryList', 'Retry')}
          </Button>
        </div>
      ) : runs.length === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">
          {translate('auto.components.workflows.run-view.RunHistory.empty', 'No runs yet.')}
        </p>
      ) : (
        <ul>
          {runs.map((run) => {
            const detail = details[run.id]
            const expanded = expandedRunId === run.id
            const duration = formatRunDuration(run.startedAt, run.finishedAt)
            const isCurrent = run.id === currentRunId
            const statuses =
              detail && detail !== 'loading' && detail !== 'error'
                ? nodeAttemptStatuses(detail)
                : undefined
            const loopBody =
              detail && detail !== 'loading' && detail !== 'error'
                ? loopBodyNodeIds(detail.workflowSnapshot.nodes)
                : undefined
            return (
              <li
                key={run.id}
                data-current={isCurrent || undefined}
                className={cn(
                  'border-b border-border px-3 py-2 last:border-b-0',
                  isCurrent && 'bg-accent'
                )}
              >
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-expanded={expanded}
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
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4}>
                      {translate(
                        'auto.components.workflows.run-view.RunHistory.details',
                        'Details'
                      )}
                    </TooltipContent>
                  </Tooltip>
                  <span className="min-w-0 flex-1 truncate text-xs">
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenRun(run.id)}
                  >
                    {translate('auto.components.workflows.run-view.RunHistory.open', 'Open')}
                  </Button>
                </div>
                {expanded ? (
                  <div className="mt-2 pl-6">
                    {detail === 'loading' || detail === undefined ? (
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    ) : detail === 'error' ? (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-destructive" role="alert">
                          {translate(
                            'auto.components.workflows.run-view.RunHistory.detailError',
                            "Couldn't load this run's details."
                          )}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => fetchDetail(run.id)}
                        >
                          {translate(
                            'auto.components.workflows.run-view.RunHistory.retryDetails',
                            'Retry'
                          )}
                        </Button>
                      </div>
                    ) : statuses && loopBody ? (
                      <ul>
                        {detail.workflowSnapshot.nodes.map((node) => {
                          const state = statuses[node.id]
                          if (!state) {
                            return null
                          }
                          const key = `${run.id}:${node.id}`
                          return (
                            <NodeOutcomeRow
                              key={node.id}
                              runId={run.id}
                              runFailed={detail.state === 'failed'}
                              nodeId={node.id}
                              title={node.title}
                              state={state}
                              isLoopBody={loopBody.has(node.id)}
                              onRerun={rerunFromNode}
                              rerunning={rerunningKey === key}
                              errorMessage={
                                rerunError?.key === key ? rerunError.message : undefined
                              }
                            />
                          )
                        })}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {!error && nextCursor ? (
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
