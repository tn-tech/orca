import { useCallback, useEffect, useRef, useState } from 'react'
import { useHostClient } from '../transport/client-context'
import type { RpcOperationSender } from '../transport/rpc-operation-sender'
import type { ConnectionState } from '../transport/types'
import type { MobileWorkflowQuestion } from './workflow-run-reply-schema'
import {
  answerWorkflowQuestion,
  loadWorkflowRun,
  loadWorkflowRuns,
  type MobileWorkflowRunEntry,
  type WorkflowAnswerOutcome,
  type WorkflowQuestionAnswer
} from './workflow-run-operations'
import { createWorkflowRunsRefetcher, startWorkflowRunsRefresh } from './workflow-runs-refresh'

export type WorkflowRunsState = {
  connState: ConnectionState
  /** `null` until the first load lands. */
  runs: MobileWorkflowRunEntry[] | null
  /** The host predates workflows or doesn't offer them to mobile (R14). */
  unsupported: boolean
  error: string | null
  refreshing: boolean
  refresh: () => void
  answer: (
    question: MobileWorkflowQuestion,
    answer: WorkflowQuestionAnswer
  ) => Promise<WorkflowAnswerOutcome>
}

type RunsSetters = {
  isStale: () => boolean
  setRuns: (
    update: (runs: MobileWorkflowRunEntry[] | null) => MobileWorkflowRunEntry[] | null
  ) => void
  setUnsupported: (unsupported: boolean) => void
  setError: (error: string | null) => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Re-reads the named runs in place. A run the list hasn't seen yet needs the full list to place
 *  it, so that returns `false` and the caller reloads everything instead. */
async function refreshNamedRuns(
  client: RpcOperationSender,
  runIds: readonly string[],
  known: ReadonlySet<string>,
  setters: RunsSetters
): Promise<boolean> {
  if (runIds.some((runId) => !known.has(runId))) {
    return false
  }
  const loads = await Promise.all(runIds.map((runId) => loadWorkflowRun(client, runId)))
  if (setters.isStale()) {
    return true
  }
  if (loads.some((load) => load.kind === 'unsupported')) {
    setters.setUnsupported(true)
    setters.setRuns(() => [])
    return true
  }
  setters.setRuns((runs) =>
    (runs ?? []).flatMap((entry) => {
      const index = runIds.indexOf(entry.run.id)
      const load = index === -1 ? undefined : loads[index]
      if (!load) {
        return [entry]
      }
      return load.kind === 'loaded' ? [load.entry] : []
    })
  )
  setters.setError(null)
  return true
}

/** A host's workflow runs, kept current by `workflowRunChanged` events and `workflow-attention`
 *  notifications while the host is connected. */
export function useWorkflowRuns(hostId: string | undefined): WorkflowRunsState {
  const { client, state: connState } = useHostClient(hostId)
  const [runs, setRuns] = useState<MobileWorkflowRunEntry[] | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refetchRef = useRef<((runId?: string) => Promise<void>) | null>(null)
  const knownRunIdsRef = useRef<ReadonlySet<string>>(new Set())
  knownRunIdsRef.current = new Set(runs?.map((entry) => entry.run.id))

  useEffect(() => {
    if (!client || !hostId || connState !== 'connected') {
      return
    }
    let stale = false
    const setters: RunsSetters = { isStale: () => stale, setRuns, setUnsupported, setError }
    const loadAll = async (): Promise<void> => {
      const load = await loadWorkflowRuns(client)
      if (stale) {
        return
      }
      setUnsupported(load.kind === 'unsupported')
      setRuns(() => (load.kind === 'loaded' ? load.runs : []))
      setError(null)
    }
    const guarded = async (pass: () => Promise<void>): Promise<void> => {
      setRefreshing(true)
      try {
        await pass()
      } catch (loadError) {
        if (!stale) {
          setError(messageOf(loadError))
        }
      } finally {
        if (!stale) {
          setRefreshing(false)
        }
      }
    }
    const refetch = createWorkflowRunsRefetcher({
      loadAll: () => guarded(loadAll),
      loadRuns: (runIds) =>
        guarded(async () => {
          if (!(await refreshNamedRuns(client, runIds, knownRunIdsRef.current, setters))) {
            await loadAll()
          }
        })
    })
    refetchRef.current = refetch
    void refetch()
    const stop = startWorkflowRunsRefresh({
      client,
      hostId,
      refetch: (runId) => void refetch(runId)
    })
    return () => {
      stale = true
      refetchRef.current = null
      // Why: a load cut off by a disconnect never reaches its own `finally` reset.
      setRefreshing(false)
      stop()
    }
  }, [client, connState, hostId])

  const refresh = useCallback(() => {
    void refetchRef.current?.()
  }, [])

  const answer = useCallback(
    async (question: MobileWorkflowQuestion, reply: WorkflowQuestionAnswer) => {
      if (!client) {
        return { kind: 'error', message: 'Not connected' } satisfies WorkflowAnswerOutcome
      }
      const outcome = await answerWorkflowQuestion(
        client,
        { runId: question.runId, questionId: question.id },
        reply
      )
      // Why: the host's workflowRunChanged also arrives, but only while the event stream is up.
      if (outcome.kind === 'answered' || outcome.kind === 'not-pending') {
        void refetchRef.current?.(question.runId)
      }
      return outcome
    },
    [client]
  )

  return { connState, runs, unsupported, error, refreshing, refresh, answer }
}
