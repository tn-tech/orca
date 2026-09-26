import { isSkillInstallProviderId } from '../../../../../shared/skill-install-providers'
import {
  withRoleDispatchOverrides,
  type RoleDispatchOverrides
} from '../editor/workflow-role-dispatch-overrides'

/** Every role field a node's `overrides` can set (workflow-role-dispatch-overrides.ts' own key
 *  list), in the order they read best in the UI (FR-017). */
export const ROLE_OVERRIDABLE_FIELDS = [
  'agent',
  'model',
  'effort',
  'systemPrompt',
  'skills'
] as const

export type RoleOverridableField = (typeof ROLE_OVERRIDABLE_FIELDS)[number]

/** True when `node.overrides` sets `field` explicitly — distinct from inheriting the role's own
 *  value — so the editor can show it distinctly (FR-017). An explicit empty array/string still
 *  counts as overridden; only `undefined` means "not overridden". */
export function isRoleFieldOverridden(
  node: { overrides?: RoleDispatchOverrides },
  field: RoleOverridableField
): boolean {
  return node.overrides?.[field] !== undefined
}

/**
 * Clears `field` back to the role default. Reverting `agent` also clears `model`/`effort` (they
 * were chosen relative to the old effective agent), and reverting `model` also clears `effort` —
 * the same cascade `RoleDispatchFields`' own agent/model change handlers apply, so a revert never
 * leaves a stale, now-meaningless override behind.
 */
export function revertRoleField<T extends { overrides?: RoleDispatchOverrides }>(
  node: T,
  field: RoleOverridableField
): T {
  switch (field) {
    case 'agent':
      return withRoleDispatchOverrides(node, {
        agent: undefined,
        model: undefined,
        effort: undefined
      })
    case 'model':
      return withRoleDispatchOverrides(node, { model: undefined, effort: undefined })
    case 'effort':
      return withRoleDispatchOverrides(node, { effort: undefined })
    case 'systemPrompt':
      return withRoleDispatchOverrides(node, { systemPrompt: undefined })
    case 'skills':
      return withRoleDispatchOverrides(node, { skills: undefined })
  }
}

/** FR-020: agents outside `SKILL_INSTALL_PROVIDERS` have no documented workspace skill location,
 *  so the engine inlines skill instructions in the prompt instead — the editor warns of the
 *  fallback here. False with no agent selected yet: nothing to warn about. */
export function agentLacksWorkspaceSkillSupport(agent: string | undefined): boolean {
  return agent !== undefined && !isSkillInstallProviderId(agent)
}
