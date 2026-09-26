import { createHash } from 'node:crypto'
import type { Role, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { FetchedRole, RoleContent } from './workflow-role-import'

export type RoleImportMergeResult = {
  role: Role
  /** Set when a locally modified role was kept: the upstream commit that was not applied. */
  availableVersion?: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }
  return value
}

/** Stable across key order and absent-vs-undefined optional fields. */
export function roleContentHash(content: RoleContent): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(content)))
    .digest('hex')
}

function roleContentOf(role: Role): RoleContent {
  const { id: _id, origin: _origin, ...content } = role
  return content
}

/**
 * FR-013/FR-016: re-import takes upstream only when the local copy still matches what was last
 * imported (per `origin.contentHash`) or `overwriteLocal` is set. Otherwise the local role and its
 * original origin are kept, flagged `localModified`, and the unapplied upstream commit reported.
 * A role without `contentHash` (hand-written, or imported before hashes) counts as possibly edited.
 */
export function applyImportedRole(
  existing: Role | undefined,
  fetched: FetchedRole,
  options: { overwriteLocal?: boolean } = {}
): RoleImportMergeResult {
  const upstreamHash = roleContentHash(fetched.content)
  const upstream: Role = {
    id: fetched.roleId,
    ...fetched.content,
    origin: {
      source: fetched.source,
      version: fetched.version,
      importedAt: fetched.importedAt,
      localModified: false,
      contentHash: upstreamHash
    }
  }
  if (!existing || options.overwriteLocal) {
    return { role: upstream }
  }
  const localHash = roleContentHash(roleContentOf(existing))
  // Identical content loses nothing, whatever the recorded origin says.
  if (localHash === upstreamHash) {
    return { role: upstream }
  }
  if (existing.origin?.contentHash !== undefined && existing.origin.contentHash === localHash) {
    return { role: upstream }
  }
  const kept: Role = existing.origin
    ? { ...existing, id: fetched.roleId, origin: { ...existing.origin, localModified: true } }
    : { ...existing, id: fetched.roleId }
  return { role: kept, availableVersion: fetched.version }
}

/** Copies the fetched role into `definition.roles` under its role id. */
export function withImportedRole(
  definition: Workflow,
  fetched: FetchedRole,
  options: { overwriteLocal?: boolean } = {}
): RoleImportMergeResult & { definition: Workflow } {
  const merged = applyImportedRole(definition.roles[fetched.roleId], fetched, options)
  return {
    ...merged,
    definition: { ...definition, roles: { ...definition.roles, [fetched.roleId]: merged.role } }
  }
}
