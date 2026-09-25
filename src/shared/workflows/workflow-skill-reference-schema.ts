import { z } from 'zod'

const SkillSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plugin'), plugin: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('repository'),
      location: z.string().min(1),
      version: z.string().optional()
    })
    .strict()
])

export type SkillSource = z.infer<typeof SkillSourceSchema>

/** A skill a role can use, from a plugin or an allowlisted repository (data-model.md §1). */
export const SkillReferenceSchema = z
  .object({
    name: z.string().min(1),
    source: SkillSourceSchema,
    required: z.boolean().default(true)
  })
  .strict()

export type SkillReference = z.infer<typeof SkillReferenceSchema>
