import { z } from 'zod'
import { ConditionSchema } from './workflow-condition-schema'
import { SkillReferenceSchema } from './workflow-skill-reference-schema'

/** Embedded JSON Schema for a structured result; only the object-root shape is enforced here. */
export const ResultContractSchema = z.object({ type: z.literal('object') }).catchall(z.unknown())
export type ResultContract = z.infer<typeof ResultContractSchema>

const ArtifactSpecSchema = z.object({ path: z.string().min(1), required: z.boolean() }).strict()

const QuestionConfigSchema = z
  .object({
    timeoutMs: z.number().int().positive(),
    escalationGraceMs: z.number().int().positive()
  })
  .strict()

/** Per-node overrides of role fields (Partial<Pick<Role, ...>> in data-model.md §1). */
const OverridesSchema = z
  .object({
    agent: z.string().min(1).optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    systemPrompt: z.string().optional(),
    skills: z.array(SkillReferenceSchema).optional()
  })
  .strict()

const nodeBaseFields = {
  id: z.string().min(1),
  title: z.string().min(1),
  notes: z.string().optional()
}

/** Agent/router/reflection nodes all dispatch a role with an optional override + prompt. */
const roleDispatchFields = {
  roleId: z.string().min(1).optional(),
  overrides: OverridesSchema.optional(),
  prompt: z.string().min(1)
}

const StartNodeSchema = z.object({ ...nodeBaseFields, type: z.literal('start') }).strict()
const EndNodeSchema = z.object({ ...nodeBaseFields, type: z.literal('end') }).strict()

const AgentNodeSchema = z
  .object({
    ...nodeBaseFields,
    ...roleDispatchFields,
    type: z.literal('agent'),
    workspace: z.enum(['run', 'child']),
    resultContract: ResultContractSchema,
    artifacts: z.array(ArtifactSpecSchema),
    question: QuestionConfigSchema
  })
  .strict()

const RouterNodeSchema = z
  .object({
    ...nodeBaseFields,
    ...roleDispatchFields,
    type: z.literal('router'),
    choices: z.array(z.string().min(1)).min(1)
  })
  .strict()

const LoopNodeSchema = z
  .object({
    ...nodeBaseFields,
    type: z.literal('loop'),
    body: z.object({ nodeIds: z.array(z.string().min(1)).min(1) }).strict(),
    entryNodeId: z.string().min(1),
    exitNodeId: z.string().min(1),
    maxIterations: z.number().int().min(1),
    exitCondition: ConditionSchema,
    // Fixed to 'fail' in v1 (data-model.md §1); files may omit it, as the U02 fixtures do.
    onCapReached: z.literal('fail').default('fail')
  })
  .strict()

const JoinNodeSchema = z
  .object({
    ...nodeBaseFields,
    type: z.literal('join'),
    policy: z.union([
      z.literal('all'),
      z.literal('any'),
      z.object({ quorum: z.number().int().positive() }).strict()
    ]),
    onFailure: z.enum(['fail', 'skip', 'partial'])
  })
  .strict()

const ApprovalNodeSchema = z
  .object({
    ...nodeBaseFields,
    type: z.literal('approval'),
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(1),
    timeoutMs: z.number().int().positive(),
    escalationGraceMs: z.number().int().positive(),
    defaultOption: z.string().min(1).optional()
  })
  .strict()

const ReflectionNodeSchema = z
  .object({
    ...nodeBaseFields,
    ...roleDispatchFields,
    type: z.literal('reflection')
  })
  .strict()

export const NodeSchema = z.discriminatedUnion('type', [
  StartNodeSchema,
  EndNodeSchema,
  AgentNodeSchema,
  RouterNodeSchema,
  LoopNodeSchema,
  JoinNodeSchema,
  ApprovalNodeSchema,
  ReflectionNodeSchema
])

export type Node = z.infer<typeof NodeSchema>
export type StartNode = z.infer<typeof StartNodeSchema>
export type EndNode = z.infer<typeof EndNodeSchema>
export type AgentNode = z.infer<typeof AgentNodeSchema>
export type RouterNode = z.infer<typeof RouterNodeSchema>
export type LoopNode = z.infer<typeof LoopNodeSchema>
export type JoinNode = z.infer<typeof JoinNodeSchema>
export type ApprovalNode = z.infer<typeof ApprovalNodeSchema>
export type ReflectionNode = z.infer<typeof ReflectionNodeSchema>
