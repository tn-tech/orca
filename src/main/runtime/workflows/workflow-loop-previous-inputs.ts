// `${loop.previous.<nodeId>}` inputs for Loop body nodes (FR-028).
import type { BriefReferenceInputs } from '../../../shared/workflows/workflow-brief-references'
import type { LoopNode, Workflow } from '../../../shared/workflows/workflow-definition-types'
import { latestAttemptByNode, type FrontierAttempt } from './workflow-frontier'

/**
 * `${loop.previous.<nodeId>}` data for a body node: every body node's completed result from the
 * previous iteration (FR-028). Empty on iteration 0; undefined outside any Loop body.
 */
export function loopPreviousInputs(
  definition: Workflow,
  attempts: readonly FrontierAttempt[],
  nodeId: string,
  iteration: number
): BriefReferenceInputs['loopPrevious'] {
  const loop = definition.nodes.find(
    (candidate): candidate is LoopNode =>
      candidate.type === 'loop' && candidate.body.nodeIds.includes(nodeId)
  )
  if (!loop) {
    return undefined
  }
  const body = new Set(loop.body.nodeIds)
  const previous = latestAttemptByNode(
    attempts.filter(
      (attempt) =>
        body.has(attempt.nodeId) &&
        attempt.iteration === iteration - 1 &&
        attempt.state === 'completed' &&
        attempt.resultJson !== undefined
    )
  )
  return Object.fromEntries(
    [...previous].map(([bodyNodeId, attempt]) => [
      bodyNodeId,
      { result: attempt.resultJson ?? null }
    ])
  )
}
