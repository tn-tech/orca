import { translate } from '@/i18n/i18n'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'

export type DescribedWorkflowProblem = {
  message: string
  location: string | undefined
}

type NamedElements = Pick<Workflow, 'nodes' | 'edges' | 'roles'>

const EMPTY_DEFINITION: NamedElements = { nodes: [], edges: [], roles: {} }

/** A node's title, a type-based name when untitled, or the raw id when it no longer exists. */
export function workflowNodeName(definition: NamedElements, nodeId: string): string {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    return nodeId
  }
  // An emptied title would otherwise fall back to a generated UUID id.
  return (
    node.title ||
    translate(
      'auto.components.workflows.editor.workflow-problem-labels.untitled',
      'Untitled {{type}}',
      {
        type: node.type
      }
    )
  )
}

function edgeName(definition: NamedElements, edgeId: string): string {
  const edge = definition.edges.find((candidate) => candidate.id === edgeId)
  return edge
    ? `${workflowNodeName(definition, edge.from)} → ${workflowNodeName(definition, edge.to)}`
    : edgeId
}

function roleName(definition: NamedElements, roleId: string): string {
  return definition.roles[roleId]?.name || roleId
}

/** Validation messages are built host-side with raw ids (they also feed the CLI). Only the ids
 *  the problem itself declares are renamed (plus Loop rules' node ids): other quoted text (router
 *  options, agent ids) may coincide with an id without naming that element. */
function nameDeclaredIds(
  message: string,
  problem: WorkflowProblem,
  definition: NamedElements
): string {
  const names = new Map<string, string>()
  if (problem.roleId && definition.roles[problem.roleId]) {
    names.set(problem.roleId, roleName(definition, problem.roleId))
  }
  if (problem.edgeId && definition.edges.some((edge) => edge.id === problem.edgeId)) {
    names.set(problem.edgeId, edgeName(definition, problem.edgeId))
  }
  if (problem.nodeId && definition.nodes.some((node) => node.id === problem.nodeId)) {
    names.set(problem.nodeId, workflowNodeName(definition, problem.nodeId))
  }
  // Loop rule messages (workflow-graph-loop-rules.ts) quote nothing but node ids.
  if (problem.code.startsWith('graph_loop_')) {
    for (const node of definition.nodes) {
      names.set(node.id, workflowNodeName(definition, node.id))
    }
  }
  return message.replace(
    /(\b(?:Node|node|Loop|loop|Join|join|Edge|edge|Role|role) )"([^"]+)"/g,
    (whole, prefix: string, id: string) => {
      const name = names.get(id)
      return name === undefined ? whole : `${prefix}"${name}"`
    }
  )
}

function location(problem: WorkflowProblem, definition: NamedElements): string | undefined {
  if (problem.nodeId) {
    return translate(
      'auto.components.workflows.editor.ValidationProblemsPanel.locationNode',
      'Node "{{id}}"',
      { id: workflowNodeName(definition, problem.nodeId) }
    )
  }
  if (problem.edgeId) {
    return translate(
      'auto.components.workflows.editor.ValidationProblemsPanel.locationEdge',
      'Edge "{{id}}"',
      { id: edgeName(definition, problem.edgeId) }
    )
  }
  if (problem.roleId) {
    return translate(
      'auto.components.workflows.editor.ValidationProblemsPanel.locationRole',
      'Role "{{id}}"',
      { id: roleName(definition, problem.roleId) }
    )
  }
  return undefined
}

/** N7: a problem as the editor shows it — nodes, edges and roles named by title, not id. Without
 *  a definition every element keeps its raw id. */
export function describeWorkflowProblem(
  problem: WorkflowProblem,
  definition: NamedElements = EMPTY_DEFINITION
): DescribedWorkflowProblem {
  return {
    message: nameDeclaredIds(problem.message, problem, definition),
    location: location(problem, definition)
  }
}
