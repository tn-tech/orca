import { z } from 'zod'
import { SkillReferenceSchema, type SkillReference } from './workflow-skill-reference-schema'

/**
 * Caps on what one Reflection may propose. Proposals are stored, returned by every
 * `workflow.run.show` (mobile included) and written into the workflow file on accept.
 */
export const ROLE_PROPOSAL_LIMITS = {
  proposals: 20,
  roleIdChars: 200,
  systemPromptChars: 32_000,
  evidenceChars: 4_000,
  skills: 50,
  /** Each string inside a proposed skill reference: name, plugin, location, version. */
  skillFieldChars: 500
} as const

function skillFieldsWithinCap(skill: SkillReference): boolean {
  const { source } = skill
  const fields = [
    skill.name,
    source.kind === 'plugin' ? source.plugin : source.location,
    source.kind === 'repository' ? source.version : undefined
  ]
  return fields.every(
    (field) => field === undefined || field.length <= ROLE_PROPOSAL_LIMITS.skillFieldChars
  )
}

/** One Reflection proposal as `result.json` carries it (contracts/agent-brief.md). */
export const RoleProposalSchema = z.object({
  roleId: z.string().min(1).max(ROLE_PROPOSAL_LIMITS.roleIdChars),
  change: z
    .object({
      systemPrompt: z.string().min(1).max(ROLE_PROPOSAL_LIMITS.systemPromptChars).optional(),
      skills: z
        .array(
          SkillReferenceSchema.refine(skillFieldsWithinCap, {
            message: `skill fields are limited to ${ROLE_PROPOSAL_LIMITS.skillFieldChars} characters`
          })
        )
        .max(ROLE_PROPOSAL_LIMITS.skills)
        .optional()
    })
    .strict(),
  evidence: z.string().min(1).max(ROLE_PROPOSAL_LIMITS.evidenceChars)
})

export type RoleProposal = z.infer<typeof RoleProposalSchema>
/** Before defaults: a skill's `required` may be omitted (it defaults to true). */
export type RoleProposalInput = z.input<typeof RoleProposalSchema>
export const RoleProposalChangeSchema = RoleProposalSchema.shape.change
