import { z } from 'zod'

/** Any JSON-serializable value; used for condition operand literals (data-model.md §1). */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
)

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

const ConditionLeafSchema = z
  .object({
    path: z.string().min(1),
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'truthy', 'falsy', 'contains', 'lengthGt']),
    value: JsonValueSchema.optional()
  })
  .strict()

/** Evaluated only against the source node's structured result (FR-027); no expression language. */
export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    ConditionLeafSchema,
    z.object({ all: z.array(ConditionSchema) }).strict(),
    z.object({ any: z.array(ConditionSchema) }).strict(),
    z.object({ not: ConditionSchema }).strict()
  ])
)

type ConditionLeaf = z.infer<typeof ConditionLeafSchema>
export type Condition =
  | ConditionLeaf
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
