import { useCallback, useEffect, useRef, useState } from 'react'
import { useHostClient } from '../transport/client-context'
import type { ConnectionState } from '../transport/types'
import type { MobileWorkflowQuestion } from './workflow-run-reply-schema'
import {
  answerWorkflowQuestion,
  loadWorkflowRuns,
  type MobileWorkflowRunEntry,
  type WorkflowAnswerOutcome,
  type WorkflowQuestionAnswer
} from './workflow-run-operations'
import { createCoalescedRefetch, startWorkflowRunsRefresh } from './workflow-runs-refresh'

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

/** A host's workflow runs, kept current by `workflowRunChanged` events and `workflow-attention`
 *  notifications while the host is connected. */
export function useWorkflowRuns(hostId: string | undefined): WorkflowRunsState {
  const { client, state: connState } = useHostClient(hostId)
  const [runs, setRuns] = useState<MobileWorkflowRunEntry[] | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refetchRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!client || !hostId || connState !== 'connected') {
      return
    }
    let stale = false
    const refetch = createCoalescedRefetch(async () => {
      setRefreshing(true)
      try {
        const load = await loadWorkflowRuns(client)
        if (stale) {
          return
        }
        setUnsupported(load.kind === 'unsupported')
        setRuns(load.kind === 'loaded' ? load.runs : [])
        setError(null)
      } catch (loadError) {
        if (!stale) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      } finally {
        if (!stale) {
          setRefreshing(false)
        }
      }
    })
    refetchRef.current = refetch
    void refetch()
    const stop = startWorkflowRunsRefresh({ client, hostId, refetch: () => void refetch() })
    return () => {
      stale = true
      refetchRef.current = null
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
        refresh()
      }
      return outcome
    },
    [client, refresh]
  )

  return { connState, runs, unsupported, error, refreshing, refresh, answer }
}
