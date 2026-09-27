import type { WorkflowProblem } from '../../../shared/workflows/workflow-problem'

/** Thrown by `startRun` when graph validation reports any error-severity problem. */
export class WorkflowGraphValidationError extends Error {
  constructor(readonly problems: WorkflowProblem[]) {
    super('workflow_graph_invalid')
    this.name = 'WorkflowGraphValidationError'
  }
}
