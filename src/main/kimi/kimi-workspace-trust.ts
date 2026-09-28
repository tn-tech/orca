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

type KimiTrustTarget = { kimiHome: string; roots: string[] }

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
  for (const root of target.roots) {
    const recordPath = join(trustDir, kimiWorkspaceTrustKey(root))
    if (existsSync(recordPath)) {
      continue
    }
    // Why 0o700/0o600: the modes Kimi itself uses for its home and trust records.
    mkdirSync(trustDir, { recursive: true, mode: 0o700 })
    writeFileAtomically(recordPath, kimiWorkspaceTrustRecord(root), { mode: 0o600 })
  }
}

/**
 * Kimi's TUI keys trust by `process.cwd()` (dist/main.mjs: `const workDir = process.cwd()`).
 * On POSIX that is getcwd(), which the kernel reports with symlinks resolved — so the realpath is
 * the key. On Windows it is GetCurrentDirectory, which keeps the path the process was spawned in
 * (junction, subst or mapped drive intact) and Kimi only `path.win32.resolve`s it — so the path as
 * launched is the key. Windows also gets the realpath key, for a launcher that resolved first.
 */
async function resolveKimiTrustTarget(
  workspacePath: string,
  deps: MarkKimiWorkspaceTrustedDeps
): Promise<KimiTrustTarget | null> {
  const platform = deps.platform ?? process.platform
  const resolved = realpathOrSelf(workspacePath)
  const wsl = platform === 'win32' ? parseWslUncPath(resolved) : null
  if (wsl) {
    // Why: a WSL worktree's Kimi runs inside the distro — it reads the distro user's
    // ~/.kimi-code and keys trust by the Linux cwd (getcwd, resolved), never the UNC path.
    const distroHome = await (deps.resolveWslHome ?? getWslHomeAsync)(wsl.distro)
    return distroHome ? { kimiHome: join(distroHome, '.kimi-code'), roots: [wsl.linuxPath] } : null
  }
  const roots =
    platform === 'win32' && resolved !== workspacePath ? [workspacePath, resolved] : [resolved]
  return { kimiHome: getHostKimiHome(), roots }
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    return p
  }
}
