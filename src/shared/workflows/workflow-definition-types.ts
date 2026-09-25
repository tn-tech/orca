// Types shared by host, renderer, CLI and mobile (data-model.md §1). Inferred from the zod
// schemas in workflow-definition-schema.ts / workflow-node-schemas.ts / workflow-condition-schema.ts
// / workflow-skill-reference-schema.ts, which are the single source of truth for these shapes.
import type { Node } from './workflow-node-schemas'

export type { WorkflowProblem, WorkflowProblemSeverity } from './workflow-problem'
export type { SkillSource, SkillReference } from './workflow-skill-reference-schema'
export type { JsonValue, Condition } from './workflow-condition-schema'
export type {
  ResultContract,
  Node,
  StartNode,
  EndNode,
  AgentNode,
  RouterNode,
  LoopNode,
  JoinNode,
  ApprovalNode,
  ReflectionNode
} from './workflow-node-schemas'
export type { Workflow, Role, Edge, Layout } from './workflow-definition-schema'

/** Fields common to every node type; each node's own schema owns the full shape. */
export type NodeBase = { id: string; type: Node['type']; title: string; notes?: string }
