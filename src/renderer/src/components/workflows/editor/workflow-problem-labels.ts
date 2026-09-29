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

function nodeName(definition: NamedElements, nodeId: string): string {
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
  return edge ? `${nodeName(definition, edge.from)} → ${nodeName(definition, edge.to)}` : edgeId
}

function roleName(definition: NamedElements, roleId: string): string {
  return definition.roles[roleId]?.name || roleId
}

/** Validation messages are built host-side with raw ids (they also feed the CLI); only the
 *  editor swaps quoted ids for the titles the user actually sees on the canvas. */
function nameQuotedIds(message: string, definition: NamedElements): string {
  const nodeIds = new Set(definition.nodes.map((node) => node.id))
  const edgeIds = new Set(definition.edges.map((edge) => edge.id))
  return message.replace(/"([^"]+)"/g, (quoted, id: string) => {
    if (nodeIds.has(id)) {
      return `"${nodeName(definition, id)}"`
    }
    if (edgeIds.has(id)) {
      return `"${edgeName(definition, id)}"`
    }
    if (definition.roles[id]) {
      return `"${roleName(definition, id)}"`
    }
    return quoted
  })
}

function location(problem: WorkflowProblem, definition: NamedElements): string | undefined {
  if (problem.nodeId) {
    return translate(
      'auto.components.workflows.editor.ValidationProblemsPanel.locationNode',
      'Node "{{id}}"',
      { id: nodeName(definition, problem.nodeId) }
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
    message: nameQuotedIds(problem.message, definition),
    location: location(problem, definition)
  }
}
