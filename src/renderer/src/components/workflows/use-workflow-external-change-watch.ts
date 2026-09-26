import { useEffect, useRef } from 'react'
import { subscribeRuntimeFileChanges } from '@/runtime/runtime-file-client'
import type { RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'

const EXTERNAL_CHANGE_DEBOUNCE_MS = 400

export type UseWorkflowExternalChangeWatchParams = {
  enabled: boolean
  settings: RuntimeWorkflowSettings
  worktreeId: string | null
  worktreePath: string | null
  onChange: () => void
}

/**
 * Watches the active worktree for filesystem changes while a project-scoped workflow is open
 * (FR-012 edge case: "two users edit the same workflow file"). Personal workflows live outside
 * the project (`~/.orca/workflows/`) and aren't under this worktree's watch, so callers only
 * enable this for `source: 'project'`. Any change in the worktree (not just this file) triggers
 * `onChange`, debounced — the caller re-reads the specific file and decides what to do.
 */
export function useWorkflowExternalChangeWatch({
  enabled,
  settings,
  worktreeId,
  worktreePath,
  onChange
}: UseWorkflowExternalChangeWatchParams): void {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!enabled || !worktreeId || !worktreePath) {
      return
    }
    let disposed = false
    let timer: number | undefined
    let unsubscribe: (() => void) | undefined
    void subscribeRuntimeFileChanges(
      { settings, worktreeId, worktreePath, connectionId: undefined },
      () => {
        if (disposed) {
          return
        }
        window.clearTimeout(timer)
        timer = window.setTimeout(() => onChangeRef.current(), EXTERNAL_CHANGE_DEBOUNCE_MS)
      },
      (err) => {
        console.warn('[workflows] failed to watch worktree for external changes', {
          worktreeId,
          error: err.message
        })
      }
    ).then((stop) => {
      if (disposed) {
        stop()
        return
      }
      unsubscribe = stop
    })
    return () => {
      disposed = true
      window.clearTimeout(timer)
      unsubscribe?.()
    }
  }, [enabled, settings, worktreeId, worktreePath])
}
