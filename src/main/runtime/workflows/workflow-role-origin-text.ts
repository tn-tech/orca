// The text of an imported role's file in its origin repository at the imported version, read
// through the same allowlisted, host-bound checkout as role import (U37), so an exported patch
// diffs against what the origin actually holds.
import type { Role } from '../../../shared/workflows/workflow-definition-types'
import type { RoleFetchHost } from './workflow-role-fetch-host'
import { parseRoleFile, readRoleFileFromCheckout, withRoleCheckout } from './workflow-role-import'
import { roleContentHash } from './workflow-role-import-merge'
import { findAllowedWorkflowSource } from './workflow-source-allowlist'

type RoleOrigin = NonNullable<Role['origin']>

/** The role file's text and the commit it was read at. */
export type OriginRoleText = { text: string; version: string }

// Why: `origin.version` comes from an editable workflow file and lands in git argv.
const COMMIT_ID_PATTERN = /^[0-9a-f]{7,64}$/i

function holdsImportedContent(text: string, roleId: string, origin: RoleOrigin): boolean {
  try {
    return roleContentHash(parseRoleFile(text, roleId)) === origin.contentHash
  } catch {
    return false
  }
}

/** Local hosts can fetch one commit; SSH relays refuse anything after the clone. */
async function checkoutCommit(host: RoleFetchHost, checkoutDir: string, commit: string) {
  if (!COMMIT_ID_PATTERN.test(commit)) {
    return false
  }
  try {
    await host.runGit(['fetch', '--quiet', '--depth', '1', 'origin', commit], checkoutDir)
    await host.runGit(['checkout', '--quiet', commit], checkoutDir)
    return true
  } catch {
    return false
  }
}

/**
 * `undefined` when the origin is not on the allowlist, cannot be reached, or no longer holds
 * the imported content at a commit this host can check out; the caller then falls back.
 * The default branch's text serves when it is the imported commit or holds the same content.
 */
export async function fetchOriginRoleText(
  roleId: string,
  origin: RoleOrigin,
  deps: { getHost: () => RoleFetchHost; allowlist: readonly string[] }
): Promise<OriginRoleText | undefined> {
  const source = findAllowedWorkflowSource(origin.source, deps.allowlist)
  if (source === undefined) {
    return undefined
  }
  try {
    const host = deps.getHost()
    return await withRoleCheckout(host, source, undefined, async (checkoutDir) => {
      const head = (await host.runGit(['rev-parse', 'HEAD'], checkoutDir)).trim()
      const tip = await readRoleFileFromCheckout(host, checkoutDir, roleId)
      if (head === origin.version || holdsImportedContent(tip, roleId, origin)) {
        return { text: tip, version: head }
      }
      if (!(await checkoutCommit(host, checkoutDir, origin.version))) {
        return undefined
      }
      const text = await readRoleFileFromCheckout(host, checkoutDir, roleId)
      return { text, version: origin.version }
    })
  } catch (error) {
    console.warn(`[workflow-role-proposals] could not read role ${roleId} from ${source}:`, error)
    return undefined
  }
}
