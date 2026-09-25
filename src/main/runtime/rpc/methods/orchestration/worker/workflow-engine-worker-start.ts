import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import type { WorkflowEnginePrincipal } from '../../../../workflows/workflow-engine-principal'
import type { WorkerStartInput } from './worker-start-schema'

// Why: engine workers are always fresh local terminals placed in the run workspace it names.
export function assertWorkflowEngineWorkerStart(
  params: WorkerStartInput,
  principal: WorkflowEnginePrincipal
): { worktreeId: string } {
  if (params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      'The workflow engine cannot reuse an existing terminal (--terminal). No effects were applied.',
      { effectsApplied: false }
    )
  }
  if (params.on) {
    throw new OrchestrationError(
      'invalid_argument',
      'The workflow engine does not start federated (--on) workers. No effects were applied.',
      { effectsApplied: false }
    )
  }
  if (!principal.worktreeId) {
    throw new OrchestrationError(
      'invalid_argument',
      `Workflow run ${principal.workflowRunId} has no workspace for worker placement. No effects were applied.`,
      { effectsApplied: false }
    )
  }
  return { worktreeId: principal.worktreeId }
}
