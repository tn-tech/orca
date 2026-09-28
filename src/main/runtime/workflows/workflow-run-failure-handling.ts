// Which failed nodes a run must answer for (audit N1): an End completing does not make a run with
// an unhandled failure Completed.
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import { type FrontierAttempt, latestAttemptByNode, loopExitSourceId } from './workflow-frontier'
import type { WorkflowResultFailureReason } from './workflow-result-capture'
import { containingLoop } from './workflow-join-branch-stop'

const LOOP_CAP_REACHED_REASON = 'loop_cap_reached' satisfies WorkflowResultFailureReason

/**
 * Failed top-level nodes whose failure no Join tolerated. A failure is handled only when every
 * outgoing path reaches, through nodes that were only skipped, a completed Join with
 * `onFailure: skip | partial`; a Loop that reached its cap is never handled. Loop-body attempts
 * are left out: a body failure fails its Loop (`body_failed`), whose attempt is judged instead.
 * Superseded attempts are ignored.
 */
export function unhandledFailedNodeIds(
  definition: Workflow,
  attempts: readonly FrontierAttempt[]
): string[] {
  const latest = latestAttemptByNode(attempts)
  const absorbed = (nodeId: string, seen: Set<string>): boolean => {
    if (seen.has(nodeId)) {
      return true
    }
    seen.add(nodeId)
    const targets = definition.edges
      .filter(
        (edge) => edge.fromPort !== 'body' && loopExitSourceId(definition.nodes, edge) === nodeId
      )
      .map((edge) => edge.to)
    return (
      targets.length > 0 &&
      targets.every((targetId) => {
        const target = definition.nodes.find((node) => node.id === targetId)
        const state = latest.get(targetId)?.state
        if (target?.type === 'join') {
          return target.onFailure !== 'fail' && state === 'completed'
        }
        return state === 'skipped' && absorbed(targetId, seen)
      })
    )
  }
  return definition.nodes
    .filter(
      (node) =>
        !containingLoop(definition, node.id) &&
        latest.get(node.id)?.state === 'failed' &&
        // A capped Loop fails the run whatever follows it (spec: Loop cap edge case).
        (latest.get(node.id)?.failureReason === LOOP_CAP_REACHED_REASON ||
          !absorbed(node.id, new Set()))
    )
    .map((node) => node.id)
}
