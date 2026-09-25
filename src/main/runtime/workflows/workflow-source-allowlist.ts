import type { Repo } from '../../../shared/repo-types'
import { readRepoWorkflowsConfig } from './workflow-orca-yaml-config'

export const WORKFLOW_SOURCE_NOT_ALLOWED_CODE = 'workflow_source_not_allowed'

/** Strips surrounding whitespace, a trailing slash, and a trailing `.git` suffix (case-insensitive). */
export function normalizeWorkflowSourceUrl(source: string): string {
  return source
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
}

/** True when `source` exact-matches (after normalisation) an allowlist entry. */
export function isWorkflowSourceAllowed(source: string, allowlist: readonly string[]): boolean {
  const normalized = normalizeWorkflowSourceUrl(source)
  return allowlist.some((entry) => normalizeWorkflowSourceUrl(entry) === normalized)
}

/**
 * Throws `workflow_source_not_allowed` unless `source` is on `allowlist` (FR-015a). An
 * empty or missing allowlist permits nothing — there is no implicit "anything goes" default.
 */
export function assertSourceAllowed(source: string, allowlist: readonly string[]): void {
  if (!isWorkflowSourceAllowed(source, allowlist)) {
    throw new Error(WORKFLOW_SOURCE_NOT_ALLOWED_CODE)
  }
}

/** Reads the repository-source allowlist from `orca.yaml` on the repo's execution host. */
export async function getRepoWorkflowSourceAllowlist(repo: Repo): Promise<string[]> {
  const config = await readRepoWorkflowsConfig(repo)
  return config?.allowedSources ?? []
}
