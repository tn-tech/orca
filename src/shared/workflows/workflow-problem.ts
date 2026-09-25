export type WorkflowProblemSeverity = 'error' | 'warning'

/** A structural or semantic issue found while parsing or validating a workflow definition. */
export type WorkflowProblem = {
  code: string
  message: string
  nodeId?: string
  edgeId?: string
  roleId?: string
  severity: WorkflowProblemSeverity
}
