// Kimi Code's workspace-trust record, shared by the local and SSH trust presets.
// Verified against Kimi Code 2.0.2 (dist/main.mjs): trustRecord.ts stores `{ root, trustedAt }`
// as JSON at `<KIMI_CODE_HOME>/workspace-trust/<key>`, with
// key = encodeWorkDirKey(canonicalWorkspaceRoot(process.cwd())) from workdir-slug.ts.
import { createHash } from 'node:crypto'

export const KIMI_WORKSPACE_TRUST_DIR = 'workspace-trust'

const WINDOWS_SHAPED_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/

function slugifyWorkDirName(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
    .replaceAll(/^-+|-+$/g, '')
  return slug === '' || slug === '.' || slug === '..' ? 'workspace' : slug
}

/** The file name Kimi looks up to decide whether `root` (an absolute cwd) is trusted. */
export function kimiWorkspaceTrustKey(root: string): string {
  const slashed = root.replaceAll('\\', '/').replace(/\/+$/, '')
  // Why: Kimi folds Windows roots to lowercase before hashing, so casing differences still match.
  const normalized = WINDOWS_SHAPED_ROOT.test(slashed) ? slashed.toLowerCase() : slashed
  const name = slugifyWorkDirName(normalized.split('/').pop() ?? normalized)
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12)
  return `wd_${name}_${hash}`
}

/** Same payload Kimi writes when the user picks "Trust this folder". */
export function kimiWorkspaceTrustRecord(root: string, trustedAt = Date.now()): string {
  return JSON.stringify({ root, trustedAt })
}
