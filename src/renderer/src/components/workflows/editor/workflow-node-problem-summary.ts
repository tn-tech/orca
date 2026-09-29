import type {
  Workflow,
  WorkflowProblem,
  WorkflowProblemSeverity
} from '../../../../../shared/workflows/workflow-definition-types'
import { describeWorkflowProblem } from './workflow-problem-labels'

export type WorkflowNodeProblemSummary = {
  severity: WorkflowProblemSeverity
  messages: string[]
}

export type WorkflowCanvasNodeProblems = Readonly<Record<string, WorkflowNodeProblemSummary>>

/** F7: per-node problems for the canvas's inline indicator, worst severity first. */
export function summarizeNodeProblems(
  problems: readonly WorkflowProblem[],
  definition: Workflow
): WorkflowCanvasNodeProblems {
  const summary: Record<string, WorkflowNodeProblemSummary> = {}
  for (const problem of problems) {
    if (!problem.nodeId) {
      continue
    }
    const { message } = describeWorkflowProblem(problem, definition)
    const existing = summary[problem.nodeId]
    if (!existing) {
      summary[problem.nodeId] = { severity: problem.severity, messages: [message] }
      continue
    }
    existing.messages.push(message)
    if (problem.severity === 'error') {
      existing.severity = 'error'
    }
  }
  return summary
}
