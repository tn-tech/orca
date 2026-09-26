/** Human-readable `orca workflows` output. See contracts/cli.md. */

import type {
  JsonValue,
  WorkflowProblem,
  Workflow
} from '../../shared/workflows/workflow-definition-types'
import type {
  NodeAttemptView,
  RunEventView,
  RunQuestionView,
  RunSnapshot,
  RunSummary,
  WorkflowRunSource
} from '../../shared/workflows/workflow-run-types'

export type WorkflowListItem = {
  name: string
  source: WorkflowRunSource
  path: string
  description?: string
  valid: boolean
}

export type WorkflowReadResult = {
  definition: Workflow | undefined
  raw: string
  revision: string
  problems: WorkflowProblem[]
}

export type WorkflowRunStatusResult = RunSnapshot & {
  attempts: NodeAttemptView[]
  questions: RunQuestionView[]
  events: RunEventView[]
}

function formatWorkflowProblemLine(problem: WorkflowProblem): string {
  const location = [
    problem.nodeId ? `node=${problem.nodeId}` : undefined,
    problem.edgeId ? `edge=${problem.edgeId}` : undefined,
    problem.roleId ? `role=${problem.roleId}` : undefined
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ')
  return `  [${problem.severity}] ${problem.code}: ${problem.message}${location ? ` (${location})` : ''}`
}

export function formatWorkflowList(result: { workflows: WorkflowListItem[] }): string {
  if (result.workflows.length === 0) {
    return 'No workflows found.'
  }
  return result.workflows
    .map((workflow) => {
      const status = workflow.valid ? 'valid' : 'invalid'
      const description = workflow.description ? `\n  ${workflow.description}` : ''
      return `${workflow.name}  ${workflow.source}  ${status}\n  ${workflow.path}${description}`
    })
    .join('\n\n')
}

export function formatWorkflowShow(result: WorkflowReadResult): string {
  const definition = result.definition
  const lines = [`revision: ${result.revision}`]
  if (definition) {
    lines.push(
      `name: ${definition.name}`,
      ...(definition.description ? [`description: ${definition.description}`] : []),
      `workspacePolicy: ${definition.workspacePolicy}`,
      `concurrencyLimit: ${definition.concurrencyLimit ?? 'default'}`,
      '',
      'nodes:',
      ...definition.nodes.map((node) => `  ${node.id}  ${node.type}  ${node.title}`),
      '',
      'edges:',
      ...definition.edges.map(
        (edge) => `  ${edge.from} -> ${edge.to}${edge.fromPort ? ` (${edge.fromPort})` : ''}`
      )
    )
    const roleIds = Object.keys(definition.roles)
    if (roleIds.length > 0) {
      lines.push('', 'roles:', ...roleIds.map((id) => `  ${id}  ${definition.roles[id]!.agent}`))
    }
  } else {
    lines.push('definition: (unparsed — see problems below)')
  }
  if (result.problems.length > 0) {
    lines.push('', 'problems:', ...result.problems.map(formatWorkflowProblemLine))
  }
  return lines.join('\n')
}

export function formatWorkflowValidate(result: { problems: WorkflowProblem[] }): string {
  if (result.problems.length === 0) {
    return 'No problems found.'
  }
  return result.problems.map(formatWorkflowProblemLine).join('\n')
}

export function formatWorkflowRunStart(result: { runId: string }): string {
  return `Started workflow run ${result.runId}.`
}

export function formatWorkflowRunList(result: { runs: RunSummary[]; nextCursor?: string }): string {
  if (result.runs.length === 0) {
    return 'No workflow runs found.'
  }
  const lines = result.runs.map(
    (run) => `${run.id}  ${run.workflowName}  ${run.state}  ${run.createdAt}`
  )
  return (result.nextCursor ? [...lines, `nextCursor: ${result.nextCursor}`] : lines).join('\n')
}

function formatWorkflowAttemptLine(attempt: NodeAttemptView): string {
  const failure = attempt.failureReason ? `  failure=${attempt.failureReason}` : ''
  return `  ${attempt.nodeId} (iteration ${attempt.iteration})  ${attempt.state}${failure}`
}

export function formatWorkflowRunStatus(result: WorkflowRunStatusResult): string {
  const lines = [
    `id: ${result.id}`,
    `workflow: ${result.workflowName} (${result.workflowSource})`,
    `state: ${result.state}`,
    `objective: ${result.objective}`,
    `createdAt: ${result.createdAt}`,
    ...(result.startedAt ? [`startedAt: ${result.startedAt}`] : []),
    ...(result.finishedAt ? [`finishedAt: ${result.finishedAt}`] : [])
  ]
  if (result.attempts.length > 0) {
    lines.push('', 'attempts:', ...result.attempts.map(formatWorkflowAttemptLine))
  }
  const pendingQuestions = result.questions.filter((question) => question.state === 'pending')
  if (pendingQuestions.length > 0) {
    lines.push(
      '',
      'pending questions:',
      ...pendingQuestions.map(
        (question) => `  ${question.id}  ${question.kind}  ${question.prompt}`
      )
    )
  }
  return lines.join('\n')
}

function isJsonRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One `--wait` progress line per `workflow.run.events` entry (contracts/cli.md `status --wait`). */
export function formatWorkflowRunEventLine(event: RunEventView): string {
  const scope = event.attemptId ? `attempt ${event.attemptId}` : 'run'
  const details = isJsonRecord(event.payloadJson)
    ? Object.entries(event.payloadJson)
        .map(
          ([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`
        )
        .join(' ')
    : ''
  return `${event.createdAt}  ${scope}  ${event.kind}${details ? `  ${details}` : ''}`
}
