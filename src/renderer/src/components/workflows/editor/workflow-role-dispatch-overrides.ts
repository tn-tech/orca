import type { AgentNode } from '../../../../../shared/workflows/workflow-definition-types'

// AgentNode and RouterNode share the exact same `overrides` shape (both spread
// `roleDispatchFields`'s `OverridesSchema` in workflow-node-schemas.ts), so one merge helper
// covers both — reusing `AgentNode['overrides']` here rather than declaring the field list again.
export type RoleDispatchOverrides = NonNullable<AgentNode['overrides']>

const OVERRIDE_KEYS: readonly (keyof RoleDispatchOverrides)[] = [
  'agent',
  'model',
  'effort',
  'systemPrompt',
  'skills'
]

/**
 * Merges a role-dispatch override patch onto `node.overrides`, dropping any key the patch
 * explicitly clears back to `undefined` (e.g. `RoleDispatchFields`' agent-change cascade resets
 * model/effort), and dropping the whole `overrides` object once nothing is left. Shared by
 * `AgentNodeFields` and `RouterNodeFields` — both dispatch a role the same way.
 */
export function withRoleDispatchOverrides<T extends { overrides?: RoleDispatchOverrides }>(
  node: T,
  patch: Partial<RoleDispatchOverrides>
): T {
  const merged: RoleDispatchOverrides = { ...node.overrides, ...patch }
  for (const key of OVERRIDE_KEYS) {
    if (merged[key] === undefined) {
      delete merged[key]
    }
  }
  return { ...node, overrides: Object.keys(merged).length > 0 ? merged : undefined }
}
