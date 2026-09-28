// Decides whether a run is over once its frontier is quiet (data-model.md §4).
import { ACTIVE_ATTEMPT_STATES } from '../../../shared/workflows/workflow-node-states'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { unhandledFailedNodeIds } from './workflow-run-failure-handling'
import type { WorkflowRunRecorder } from './workflow-run-recorder'

/**
 * Nothing active and nothing eligible: the run is over. It completes only when an End node
 * completed and no failure is left unhandled; otherwise it fails.
 */
export function settleRunIfQuiet(
  db: OrchestrationDb,
  recorder: WorkflowRunRecorder,
  definition: Workflow
): void {
  const run = db.getWorkflowRun(recorder.runId)
  if (!run || (run.state !== 'running' && run.state !== 'waiting')) {
    return
  }
  const attempts = db.listWorkflowAttempts(recorder.runId)
  // A Waiting Join alone cannot move: its pending branches have nothing left to settle them.
  const stuckJoin = (a: NodeAttemptView) => a.nodeType === 'join' && a.state === 'waiting'
  if (attempts.some((a) => ACTIVE_ATTEMPT_STATES.has(a.state) && !stuckJoin(a))) {
    return
  }
  for (const join of attempts.filter(stuckJoin)) {
    recorder.transitionAttempt(join.id, 'cancelled', { reason: 'join_unreachable' })
  }
  // Unhandled, non-superseded failures only; the payload keeps its `string[]` shape.
  const failedNodes = unhandledFailedNodeIds(definition, attempts)
  if (
    failedNodes.length === 0 &&
    attempts.some((attempt) => attempt.nodeType === 'end' && attempt.state === 'completed')
  ) {
    recorder.transitionRun('completed', 'run_completed')
    return
  }
  recorder.transitionRun('failed', 'run_failed', {
    reason: failedNodes.length > 0 ? 'node_failed' : 'end_unreachable',
    failedNodes
  })
}
