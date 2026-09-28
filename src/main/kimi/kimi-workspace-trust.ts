import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import { getWslHomeAsync } from '../wsl'
import { getHostKimiHome } from './kimi-runtime-home'
import {
  KIMI_WORKSPACE_TRUST_DIR,
  kimiWorkspaceTrustKey,
  kimiWorkspaceTrustRecord
} from './kimi-workspace-trust-record'

type KimiTrustTarget = { kimiHome: string; root: string }

export type MarkKimiWorkspaceTrustedDeps = {
  platform?: NodeJS.Platform
  /** UNC home of a WSL distro, or null when it cannot be probed. */
  resolveWslHome?: (distro: string) => Promise<string | null>
}

/**
 * Pre-writes Kimi Code's workspace-trust record so its startup "Trust this folder?" gate
 * (asked for every untrusted cwd, before any session starts) does not stall the launch.
 */
export async function markKimiWorkspaceTrusted(
  workspacePath: string,
  deps: MarkKimiWorkspaceTrustedDeps = {}
): Promise<void> {
  const target = await resolveKimiTrustTarget(workspacePath, deps)
  if (!target) {
    return
  }
  const trustDir = join(target.kimiHome, KIMI_WORKSPACE_TRUST_DIR)
  const recordPath = join(trustDir, kimiWorkspaceTrustKey(target.root))
  if (existsSync(recordPath)) {
    return
  }
  // Why 0o700/0o600: the modes Kimi itself uses for its home and trust records.
  mkdirSync(trustDir, { recursive: true, mode: 0o700 })
  writeFileAtomically(recordPath, kimiWorkspaceTrustRecord(target.root), { mode: 0o600 })
}

async function resolveKimiTrustTarget(
  workspacePath: string,
  deps: MarkKimiWorkspaceTrustedDeps
): Promise<KimiTrustTarget | null> {
  const root = realpathOrSelf(workspacePath)
  const wsl = (deps.platform ?? process.platform) === 'win32' ? parseWslUncPath(root) : null
  if (!wsl) {
    return { kimiHome: getHostKimiHome(), root }
  }
  // Why: a WSL worktree's Kimi runs inside the distro — it reads the distro user's
  // ~/.kimi-code and keys trust by the Linux cwd, never the Windows host's home or UNC path.
  const distroHome = await (deps.resolveWslHome ?? getWslHomeAsync)(wsl.distro)
  return distroHome ? { kimiHome: join(distroHome, '.kimi-code'), root: wsl.linuxPath } : null
}

// Why: Kimi keys trust by process.cwd(), which the OS reports with symlinks resolved.
function realpathOrSelf(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    return p
  }
}
