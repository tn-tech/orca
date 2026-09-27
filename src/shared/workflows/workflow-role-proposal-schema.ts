import { z } from 'zod'
import { SkillReferenceSchema } from './workflow-skill-reference-schema'

/** One Reflection proposal as `result.json` carries it (contracts/agent-brief.md). */
export const RoleProposalSchema = z.object({
  roleId: z.string().min(1),
  change: z
    .object({
      systemPrompt: z.string().min(1).optional(),
      skills: z.array(SkillReferenceSchema).optional()
    })
    .strict(),
  evidence: z.string().min(1)
})

export type RoleProposal = z.infer<typeof RoleProposalSchema>
/** Before defaults: a skill's `required` may be omitted (it defaults to true). */
export type RoleProposalInput = z.input<typeof RoleProposalSchema>
export const RoleProposalChangeSchema = RoleProposalSchema.shape.change
