// Applying a Reflection's role proposal (US7): each set field of the change replaces the role's
// own value whole. An imported role keeps its origin, flagged modified when it no longer matches it.
import type { Role } from '../../../shared/workflows/workflow-definition-types'
import type { RoleProposalChange } from '../../../shared/workflows/workflow-run-types'
import { roleContentHash, roleContentOf } from './workflow-role-import-merge'

export function applyRoleProposalChange(role: Role, change: RoleProposalChange): Role {
  return {
    ...role,
    ...(change.systemPrompt !== undefined ? { systemPrompt: change.systemPrompt } : {}),
    ...(change.skills !== undefined ? { skills: change.skills } : {})
  }
}

/**
 * The role as accepted into the workflow file. `origin.contentHash` still records what was
 * imported, so a later re-import keeps this local change (workflow-role-import-merge.ts).
 */
export function acceptedRole(role: Role, change: RoleProposalChange): Role {
  const changed = applyRoleProposalChange(role, change)
  if (!changed.origin) {
    return changed
  }
  const { contentHash } = changed.origin
  const localModified =
    contentHash === undefined || roleContentHash(roleContentOf(changed)) !== contentHash
  return { ...changed, origin: { ...changed.origin, localModified } }
}

/** Whether a field the change replaces was edited in the file after the run that proposed it. */
export function roleChangedSinceRun(
  runRole: Role | undefined,
  fileRole: Role,
  change: RoleProposalChange
): boolean {
  if (!runRole) {
    return true
  }
  return (
    (change.systemPrompt !== undefined && runRole.systemPrompt !== fileRole.systemPrompt) ||
    (change.skills !== undefined &&
      JSON.stringify(runRole.skills) !== JSON.stringify(fileRole.skills))
  )
}
