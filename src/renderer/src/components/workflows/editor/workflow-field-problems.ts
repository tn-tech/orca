import type { z } from 'zod'
import { translate } from '@/i18n/i18n'
import { WorkflowSchema } from '../../../../../shared/workflows/workflow-definition-schema'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'

export type WorkflowFieldCheck = {
  /** False when the host's `workflow.write` would reject the definition outright. */
  storable: boolean
  problems: WorkflowProblem[]
}

type PathKey = PropertyKey

function fieldLabel(key: PathKey): string {
  switch (key) {
    case 'title':
      return translate('auto.components.workflows.editor.workflow-field-problems.title', 'Title')
    case 'prompt':
      return translate('auto.components.workflows.editor.workflow-field-problems.prompt', 'Prompt')
    case 'choices':
      return translate('auto.components.workflows.editor.workflow-field-problems.choice', 'Choice')
    case 'options':
      return translate('auto.components.workflows.editor.workflow-field-problems.option', 'Option')
    case 'question':
      return translate(
        'auto.components.workflows.editor.workflow-field-problems.question',
        'Question'
      )
    case 'name':
      return translate('auto.components.workflows.editor.workflow-field-problems.name', 'Name')
    case 'agent':
      return translate('auto.components.workflows.editor.workflow-field-problems.agent', 'Agent')
    case 'systemPrompt':
      return translate(
        'auto.components.workflows.editor.workflow-field-problems.systemPrompt',
        'System prompt'
      )
    case 'path':
      return translate('auto.components.workflows.editor.workflow-field-problems.path', 'Path')
    default:
      return String(key)
  }
}

function listLabel(key: PathKey): string {
  switch (key) {
    case 'choices':
      return translate(
        'auto.components.workflows.editor.workflow-field-problems.choices',
        'Choices'
      )
    case 'options':
      return translate(
        'auto.components.workflows.editor.workflow-field-problems.options',
        'Options'
      )
    default:
      return String(key)
  }
}

/** The node, edge or role an issue sits under, so the problem can focus it. */
function issueLocation(
  definition: Workflow,
  path: readonly PathKey[]
): Pick<WorkflowProblem, 'nodeId' | 'edgeId' | 'roleId'> {
  const [collection, key] = path
  if (collection === 'nodes' && typeof key === 'number') {
    const nodeId = definition.nodes[key]?.id
    return nodeId ? { nodeId } : {}
  }
  if (collection === 'edges' && typeof key === 'number') {
    const edgeId = definition.edges[key]?.id
    return edgeId ? { edgeId } : {}
  }
  if (collection === 'roles' && typeof key === 'string') {
    return { roleId: key }
  }
  return {}
}

function issueMessage(issue: z.core.$ZodIssue): { code: string; message: string } {
  const last = issue.path.at(-1)
  const parent = issue.path.at(-2)
  if (issue.code === 'too_small' && issue.origin === 'string' && last !== undefined) {
    const message =
      typeof last === 'number' && parent !== undefined
        ? translate(
            'auto.components.workflows.editor.workflow-field-problems.itemEmpty',
            '{{field}} {{position}} is empty.',
            { field: fieldLabel(parent), position: last + 1 }
          )
        : translate(
            'auto.components.workflows.editor.workflow-field-problems.required',
            '{{field}} is required.',
            { field: fieldLabel(last) }
          )
    return { code: 'workflow_field_required', message }
  }
  if (issue.code === 'too_small' && issue.origin === 'array' && last !== undefined) {
    return {
      code: 'workflow_field_required',
      message: translate(
        'auto.components.workflows.editor.workflow-field-problems.listEmpty',
        '{{field}}: add at least one.',
        { field: listLabel(last) }
      )
    }
  }
  return {
    code: 'workflow_field_invalid',
    message: translate(
      'auto.components.workflows.editor.workflow-field-problems.invalid',
      '{{field}} is invalid: {{detail}}',
      { field: last === undefined ? '' : fieldLabel(last), detail: issue.message }
    )
  }
}

/** `graph_loop_missing_max_iterations` already reports a Loop with no cap. */
function isReportedByGraphRules(issue: z.core.$ZodIssue): boolean {
  return issue.path.at(-1) === 'maxIterations' && issue.code === 'too_small'
}

/**
 * F7: the schema checks `workflow.write` enforces, surfaced as friendly per-field problems before
 * Save instead of a raw zod toast after it. Graph-level errors still save as a draft; these can't.
 */
export function checkWorkflowFields(definition: Workflow): WorkflowFieldCheck {
  const result = WorkflowSchema.safeParse(definition)
  if (result.success) {
    return { storable: true, problems: [] }
  }
  const problems = result.error.issues
    .filter((issue) => !isReportedByGraphRules(issue))
    .map((issue) => ({
      ...issueMessage(issue),
      ...issueLocation(definition, issue.path),
      severity: 'error' as const
    }))
  return { storable: false, problems }
}
