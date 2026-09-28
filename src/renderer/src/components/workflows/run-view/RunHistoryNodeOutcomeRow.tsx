import React from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-client'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../../../shared/workflows/workflow-node-states'
import AttemptStateBadge from './AttemptStateBadge'

/** Node ids inside any Loop's body — rerunning one restarts the whole Loop from iteration 1
 *  (workflow-rerun.ts lifts the rerun to the containing Loop), so their row gets a hint instead of
 *  implying only that node re-executes. */
export function loopBodyNodeIds(nodes: Workflow['nodes']): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    if (node.type === 'loop') {
      for (const id of node.body.nodeIds) {
        ids.add(id)
      }
    }
  }
  return ids
}

/** Maps the host's rerun-refusal codes (workflow-rerun.ts) to translated copy instead of showing
 *  its raw English text, which embeds internal run ids. Unknown codes (a host version this
 *  renderer doesn't recognize yet) fall back to the host's own message. */
export function rerunRefusalMessage(err: unknown): string {
  if (hasRuntimeRpcErrorCode(err, 'method_not_found')) {
    return translate(
      'auto.components.workflows.run-view.RunHistory.rerunNotImplemented',
      "Rerunning isn't available on this host yet."
    )
  }
  if (hasRuntimeRpcErrorCode(err, 'workflow_rerun_refused')) {
    return translate(
      'auto.components.workflows.run-view.RunHistory.rerunRefused',
      "This run can't be rerun right now."
    )
  }
  if (hasRuntimeRpcErrorCode(err, 'workflow_rerun_workspace_unavailable')) {
    return translate(
      'auto.components.workflows.run-view.RunHistory.rerunWorkspaceUnavailable',
      "This run's workspace isn't available right now."
    )
  }
  return err instanceof Error ? err.message : String(err)
}

/** A single node's outcome within an expanded, failed run's detail — offers "Rerun from this
 *  node" (US8 AS2) only for a node whose latest attempt failed. The host still has the final say
 *  (draft-planner run, busy workspace, an attempt still active elsewhere); this only avoids
 *  offering the action when it plainly cannot apply. */
export default function NodeOutcomeRow({
  runId,
  runFailed,
  nodeId,
  title,
  state,
  isLoopBody,
  onRerun,
  rerunning,
  errorMessage
}: {
  runId: string
  runFailed: boolean
  nodeId: string
  title: string
  state: WorkflowAttemptState
  isLoopBody: boolean
  onRerun: (runId: string, nodeId: string) => void
  rerunning: boolean
  errorMessage?: string
}): React.JSX.Element {
  return (
    <li className="py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{title}</span>
        <AttemptStateBadge state={state} />
        {runFailed && state === 'failed' ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {isLoopBody ? (
              <span className="text-[10px] text-muted-foreground">
                {translate(
                  'auto.components.workflows.run-view.RunHistory.rerunRestartsLoop',
                  'Restarts the whole loop'
                )}
              </span>
            ) : null}
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
          </div>
        ) : null}
      </div>
      {errorMessage ? (
        <p className="pt-1 text-[11px] text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </li>
  )
}
