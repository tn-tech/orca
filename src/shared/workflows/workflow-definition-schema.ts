import { z } from 'zod'
import { ConditionSchema } from './workflow-condition-schema'
import { NodeSchema } from './workflow-node-schemas'
import { SkillReferenceSchema } from './workflow-skill-reference-schema'
import type { WorkflowProblem } from './workflow-problem'

const RoleOriginSchema = z
  .object({
    source: z.string().min(1),
    version: z.string().min(1),
    importedAt: z.string().min(1),
    localModified: z.boolean(),
    // Hash of the role content as imported; absent on roles imported before it existed.
    contentHash: z.string().min(1).optional()
  })
  .strict()

export const RoleFileSchema = z
  .object({
    name: z.string().min(1),
    agent: z.string().min(1),
    model: z.string().optional(),
    effort: z.string().optional(),
    systemPrompt: z.string().min(1),
    skills: z.array(SkillReferenceSchema),
    origin: RoleOriginSchema.optional()
  })
  .strict()

/** roles is a map keyed by role id; the id is injected onto each role from its key. */
const RolesSchema = z
  .record(z.string().min(1), RoleFileSchema)
  .transform((roles) =>
    Object.fromEntries(Object.entries(roles).map(([id, role]) => [id, { id, ...role }]))
  )

/** Roles as they appear on an already-parsed, in-memory `Workflow`. `id` is optional on input —
 *  tolerant of a file-shaped role (no `id`) from an older/newer client (remote-wire compatibility)
 *  — and always re-derived from the record key on output, exactly like `RolesSchema`'s transform,
 *  so a stray or stale `id` a caller echoes back can never win over the canonical one. */
const RolesWithIdSchema = z
  .record(z.string().min(1), RoleFileSchema.extend({ id: z.string().min(1).optional() }))
  .transform((roles) =>
    Object.fromEntries(Object.entries(roles).map(([id, role]) => [id, { ...role, id }]))
  )

const EdgeSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    fromPort: z.string().min(1).optional(),
    condition: ConditionSchema.optional()
  })
  .strict()

const workflowShapeBase = {
  version: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  concurrencyLimit: z.number().int().positive().optional(),
  workspacePolicy: z.enum(['run-workspace', 'in-place']),
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema),
  layout: z.record(z.string().min(1), z.object({ x: z.number(), y: z.number() }).strict())
}

export const WorkflowFileSchema = z.object({ ...workflowShapeBase, roles: RolesSchema }).strict()

/** Same shape as `WorkflowFileSchema`, for RPC params that carry an already-parsed `Workflow`
 *  (e.g. a prior `workflow.read` result round-tripped through `workflow.write`/`workflow.validate`)
 *  rather than raw file text — `WorkflowFileSchema` would reject its roles' injected `id` field. */
export const WorkflowSchema = z.object({ ...workflowShapeBase, roles: RolesWithIdSchema }).strict()

export type Workflow = z.infer<typeof WorkflowFileSchema>
export type Role = z.infer<typeof RolesSchema>[string]
export type Edge = z.infer<typeof EdgeSchema>
export type Layout = Workflow['layout']

const UNSUPPORTED_VERSION_CODE = 'workflow_file_version_unsupported'
const MAX_SANITIZE_PASSES = 25

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** No-op: v1 is the only known workflow file version (upgrades land on save, per contracts/workflow-file.md). */
export function upgradeWorkflowDefinition(raw: unknown): unknown {
  return raw
}

/** Parses and validates a raw (YAML-parsed) workflow file. Never throws. */
export function parseWorkflowDefinition(raw: unknown): {
  definition: Workflow | undefined
  problems: WorkflowProblem[]
} {
  if (!isRecord(raw) || raw.version !== 1) {
    return {
      definition: undefined,
      problems: [
        {
          code: UNSUPPORTED_VERSION_CODE,
          message: `Unsupported workflow file version ${JSON.stringify(isRecord(raw) ? raw.version : undefined)}; this host supports version 1.`,
          severity: 'error'
        }
      ]
    }
  }
  return sanitizeAndParse(raw)
}

function sanitizeAndParse(raw: Record<string, unknown>): {
  definition: Workflow | undefined
  problems: WorkflowProblem[]
} {
  const candidate: unknown = JSON.parse(JSON.stringify(raw))
  const removed: { path: PropertyKey[]; value: unknown }[] = []
  for (let pass = 0; pass < MAX_SANITIZE_PASSES; pass++) {
    const result = WorkflowFileSchema.safeParse(candidate)
    if (result.success) {
      const definition = result.data
      for (const entry of removed) {
        setAtPath(definition, entry.path, entry.value)
      }
      return { definition, problems: removed.map((entry) => unknownKeyProblem(entry.path)) }
    }
    const unrecognized = result.error.issues.filter((issue) => issue.code === 'unrecognized_keys')
    const other = result.error.issues.filter((issue) => issue.code !== 'unrecognized_keys')
    if (other.length > 0 || unrecognized.length === 0) {
      return { definition: undefined, problems: result.error.issues.map(issueToProblem) }
    }
    for (const issue of unrecognized) {
      for (const key of issue.keys) {
        const path: PropertyKey[] = [...issue.path, key]
        removed.push({ path, value: getAtPath(candidate, path) })
        deleteAtPath(candidate, path)
      }
    }
  }
  return {
    definition: undefined,
    problems: [
      {
        code: 'workflow_unknown_key_unstable',
        message: 'Could not stabilize unknown-key sanitization within the pass budget.',
        severity: 'error'
      }
    ]
  }
}

function unknownKeyProblem(path: readonly PropertyKey[]): WorkflowProblem {
  return {
    code: 'workflow_unknown_key',
    message: `Unrecognized field "${path.map(String).join('.')}" was kept on the definition but is not recognized by this host.`,
    severity: 'warning'
  }
}

function issueToProblem(issue: z.core.$ZodIssue): WorkflowProblem {
  return {
    code: `workflow_${issue.code}`,
    message: `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
    severity: 'error'
  }
}

function isIndexable(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null
}

function getAtPath(obj: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = obj
  for (const key of path) {
    if (!isIndexable(cur)) {
      return undefined
    }
    cur = cur[key]
  }
  return cur
}

function deleteAtPath(obj: unknown, path: readonly PropertyKey[]): void {
  const parent = getAtPath(obj, path.slice(0, -1))
  const last = path.at(-1)
  if (isIndexable(parent) && last !== undefined) {
    delete parent[last]
  }
}

function setAtPath(obj: unknown, path: readonly PropertyKey[], value: unknown): void {
  const parent = getAtPath(obj, path.slice(0, -1))
  const last = path.at(-1)
  if (isIndexable(parent) && last !== undefined) {
    parent[last] = value
  }
}
