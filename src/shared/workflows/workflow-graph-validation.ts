import type {
  AgentNode,
  Node,
  ReflectionNode,
  RouterNode,
  SkillReference,
  Workflow,
  WorkflowProblem
} from './workflow-definition-types'
import {
  checkCycles,
  checkJoinNodes,
  checkLoopNodes,
  checkPortedNodes,
  checkReachability,
  checkStartAndEnd
} from './workflow-graph-structural-rules'

/** Injected so this module never imports a renderer/main/mobile agent catalog directly. */
export type GraphValidationContext = {
  agentSupportsModel: (agent: string) => boolean
  allowlistedSources: string[]
  isKnownAgent?: (agent: string) => boolean
}

type RoleDispatchNode = AgentNode | RouterNode | ReflectionNode

function error(problem: Omit<WorkflowProblem, 'severity'>): WorkflowProblem {
  return { ...problem, severity: 'error' }
}

function isRoleDispatchNode(node: Node): node is RoleDispatchNode {
  return node.type === 'agent' || node.type === 'router' || node.type === 'reflection'
}

/** Every referenced roleId must exist, and a model/effort override needs agent support for it. */
function checkRoleReferences(
  definition: Workflow,
  context: GraphValidationContext
): WorkflowProblem[] {
  const problems: WorkflowProblem[] = []
  for (const node of definition.nodes.filter(isRoleDispatchNode)) {
    const role = node.roleId === undefined ? undefined : definition.roles[node.roleId]
    if (node.roleId !== undefined && !role) {
      problems.push(
        error({
          code: 'graph_unknown_role',
          message: `Node "${node.id}" references unknown role "${node.roleId}".`,
          nodeId: node.id,
          roleId: node.roleId
        })
      )
    }
    const overridesModelOrEffort =
      node.overrides?.model !== undefined || node.overrides?.effort !== undefined
    const effectiveAgent = node.overrides?.agent ?? role?.agent
    if (overridesModelOrEffort && effectiveAgent && !context.agentSupportsModel(effectiveAgent)) {
      problems.push(
        error({
          code: 'graph_model_override_not_supported',
          message: `Node "${node.id}" sets a model/effort override, but agent "${effectiveAgent}" has no model catalog.`,
          nodeId: node.id,
          roleId: node.roleId
        })
      )
    }
  }
  return problems
}

function checkSkillSources(
  skills: SkillReference[],
  allowlistedSources: string[],
  location: { nodeId?: string; roleId?: string }
): WorkflowProblem[] {
  return skills
    .filter(
      (skill) =>
        skill.source.kind === 'repository' && !allowlistedSources.includes(skill.source.location)
    )
    .map((skill) =>
      error({
        code: 'graph_skill_source_not_allowlisted',
        message: `Skill "${skill.name}" references a repository source that is not on the project allowlist.`,
        ...location
      })
    )
}

/** Every repository skill source, on a role or a node override, must be on the project allowlist. */
function checkSkillAllowlist(
  definition: Workflow,
  context: GraphValidationContext
): WorkflowProblem[] {
  const problems: WorkflowProblem[] = []
  for (const role of Object.values(definition.roles)) {
    problems.push(
      ...checkSkillSources(role.skills, context.allowlistedSources, { roleId: role.id })
    )
  }
  for (const node of definition.nodes.filter(isRoleDispatchNode)) {
    if (node.overrides?.skills) {
      problems.push(
        ...checkSkillSources(node.overrides.skills, context.allowlistedSources, {
          nodeId: node.id,
          roleId: node.roleId
        })
      )
    }
  }
  return problems
}

/** Reports an unknown agent id; skipped entirely when the host doesn't inject isKnownAgent. */
function checkKnownAgents(
  definition: Workflow,
  context: GraphValidationContext
): WorkflowProblem[] {
  const isKnownAgent = context.isKnownAgent
  if (!isKnownAgent) {
    return []
  }
  const problems: WorkflowProblem[] = []
  for (const role of Object.values(definition.roles)) {
    if (!isKnownAgent(role.agent)) {
      problems.push(
        error({
          code: 'graph_unknown_agent',
          message: `Role "${role.id}" uses unknown agent "${role.agent}".`,
          roleId: role.id
        })
      )
    }
  }
  for (const node of definition.nodes.filter(isRoleDispatchNode)) {
    const overrideAgent = node.overrides?.agent
    if (overrideAgent !== undefined && !isKnownAgent(overrideAgent)) {
      problems.push(
        error({
          code: 'graph_unknown_agent',
          message: `Node "${node.id}" overrides to unknown agent "${overrideAgent}".`,
          nodeId: node.id,
          roleId: node.roleId
        })
      )
    }
  }
  return problems
}

/** Shared with the engine's defensive dispatch-time refusal (workflow-node-dispatch.ts). */
export function childWorkspaceDisallowedMessage(nodeId: string): string {
  return `Node "${nodeId}" requests a child workspace, which "in-place" workflows disallow.`
}

/** Child workspaces need a dedicated worktree, which `in-place` workflows never get. */
function checkWorkspacePolicy(definition: Workflow): WorkflowProblem[] {
  if (definition.workspacePolicy !== 'in-place') {
    return []
  }
  return definition.nodes
    .filter((node): node is AgentNode => node.type === 'agent' && node.workspace === 'child')
    .map((node) =>
      error({
        code: 'graph_child_workspace_disallowed',
        message: childWorkspaceDisallowedMessage(node.id),
        nodeId: node.id
      })
    )
}

/** Structural and semantic validation shared by the editor and the host (data-model.md). */
export function validateWorkflowGraph(
  definition: Workflow,
  context: GraphValidationContext
): WorkflowProblem[] {
  const { nodes, edges } = definition
  return [
    ...checkStartAndEnd(nodes),
    ...checkReachability(nodes, edges),
    ...checkCycles(nodes, edges),
    ...checkLoopNodes(nodes, edges),
    ...checkJoinNodes(nodes, edges),
    ...checkPortedNodes(nodes, edges),
    ...checkRoleReferences(definition, context),
    ...checkSkillAllowlist(definition, context),
    ...checkKnownAgents(definition, context),
    ...checkWorkspacePolicy(definition)
  ]
}
