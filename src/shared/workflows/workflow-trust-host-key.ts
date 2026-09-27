// The per-source trust scope key (FR-018a, data-model.md §3 `workflow_source_trust`): `local` (the
// machine the Orca runtime runs on), `ssh:<connectionId>` (the SSH target a repo is bound to), or
// `wsl:<distro>` (distro name lower-cased — Windows resolves distro names case-insensitively, so
// `Ubuntu` and `UBUNTU` are one host). Shared because both the engine (a run's actual workspace
// root) and the renderer (a repo's path, before any run exists) compute the same key.
import { parseWslUncPath } from '../wsl-paths'

export const LOCAL_TRUST_HOST = 'local'

/** Where a workspace's nodes execute, as a trust scope. `workspaceRoot` is host-appropriate: the
 *  run's actual workspace root for the engine, or a repo's own path for the renderer (before any
 *  run exists — the two land on the same host, so the same path-based WSL detection applies). */
export function workflowTrustHostKey(workspace: {
  workspaceRoot: string
  orcaIgnoreTarget: { host: 'local' } | { host: 'remote'; connectionId: string }
}): string {
  if (workspace.orcaIgnoreTarget.host === 'remote') {
    return `ssh:${workspace.orcaIgnoreTarget.connectionId}`
  }
  const wsl = parseWslUncPath(workspace.workspaceRoot)
  return wsl ? `wsl:${wsl.distro.toLowerCase()}` : LOCAL_TRUST_HOST
}
