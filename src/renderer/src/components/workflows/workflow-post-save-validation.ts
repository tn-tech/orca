import { workflowValidate, type RuntimeWorkflowSettings } from '@/runtime/runtime-workflow-client'
import type { Workflow } from '../../../../shared/workflows/workflow-definition-types'
import {
  validateWorkflowGraph,
  type GraphValidationContext
} from '../../../../shared/workflows/workflow-graph-validation'
import {
  hasBlockingWorkflowProblems,
  mergeWorkflowValidationProblems
} from './editor/workflow-validation-merge'

/**
 * F8 fix round 1: a deterministic check of the definition that was just saved — local graph
 * checks, then a fresh (non-debounced) host `workflow.validate` call for the same content — rather
 * than trusting a `blockingProblems` value computed on unrelated timing (the page's debounced
 * host-revalidate effect). Short-circuits on a local error so a structurally broken definition
 * never needs the round trip. A host failure here is best-effort, matching that debounced effect:
 * it falls back to the local-only result instead of blocking a run local validation already
 * cleared.
 */
export async function hasBlockingProblemsAfterSave(
  definition: Workflow,
  context: GraphValidationContext,
  settings: RuntimeWorkflowSettings,
  repoId: string | undefined
): Promise<boolean> {
  const localProblems = validateWorkflowGraph(definition, context)
  if (hasBlockingWorkflowProblems(localProblems)) {
    return true
  }
  if (!repoId) {
    return false
  }
  try {
    const result = await workflowValidate(settings, { repo: repoId, definition })
    return hasBlockingWorkflowProblems(
      mergeWorkflowValidationProblems(localProblems, result.problems)
    )
  } catch {
    return false
  }
}
