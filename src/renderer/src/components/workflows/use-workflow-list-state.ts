import { useCallback, useEffect, useState } from 'react'
import {
  workflowList,
  type RuntimeWorkflowSettings,
  type WorkflowSummary
} from '@/runtime/runtime-workflow-client'

export type WorkflowListState = {
  rows: WorkflowSummary[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/** FR-001/FR-012: `workflow.list` already merges project and personal files, project winning
 *  a name clash — this hook just owns the fetch lifecycle around it. */
export function useWorkflowListState(
  settings: RuntimeWorkflowSettings,
  repoId: string | undefined
): WorkflowListState {
  const [rows, setRows] = useState<WorkflowSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!repoId) {
      setRows([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await workflowList(settings, repoId)
      setRows(result.workflows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [settings, repoId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { rows, loading, error, refresh }
}
