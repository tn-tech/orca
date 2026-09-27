// Expands a declared artifact glob (contracts/agent-brief.md "required artifact globs") into the
// concrete workspace-relative paths it matches, walking only the run workspace's own filesystem
// provider (local, WSL or SSH). Symlinks are never matched or descended, so no match can resolve
// outside the workspace; the caps bound a broad pattern like `**/*` on a huge workspace.
import { posix } from 'node:path'
import { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from '../runtime-relative-paths'
import type { WorkflowFilesystem } from './workflow-file-store-filesystem'

export const ARTIFACT_GLOB_MAX_MATCHES = 1000
/** Deepest path (in segments) a `**` pattern can match. */
export const ARTIFACT_GLOB_MAX_DEPTH = 32
export const ARTIFACT_GLOB_MAX_DIRECTORIES_READ = 5000

const GLOB_SYNTAX = /[*?[\]{}]/

export function isArtifactGlob(path: string): boolean {
  return GLOB_SYNTAX.test(path)
}

type WalkPlan = {
  pattern: string
  /** Leading glob-free segments: only these exact names are descended at those depths. */
  literalPrefix: string[]
  maxDepth: number
  /** `*`/`**` never match a dot segment, so dot directories are skipped unless named. */
  descendDotDirectories: boolean
}

function planWalk(pattern: string): WalkPlan {
  const normalized = normalizeRuntimeRelativePath(pattern)
  const segments = normalized.split('/')
  const firstGlob = segments.findIndex((segment) => GLOB_SYNTAX.test(segment))
  return {
    pattern: normalized,
    literalPrefix: segments.slice(0, firstGlob === -1 ? segments.length : firstGlob),
    maxDepth: segments.some((segment) => segment.includes('**'))
      ? ARTIFACT_GLOB_MAX_DEPTH
      : segments.length,
    descendDotDirectories: segments.some((segment) => segment.startsWith('.'))
  }
}

/**
 * Workspace-relative forward-slash paths (files or directories) matching `pattern`, sorted, at most
 * ARTIFACT_GLOB_MAX_MATCHES. Throws `invalid_relative_path` for an absolute or `..` pattern.
 */
export async function findArtifactGlobMatches(
  fs: WorkflowFilesystem,
  workspaceRoot: string,
  pattern: string
): Promise<string[]> {
  const plan = planWalk(pattern)
  const matches: string[] = []
  let level: string[] = ['']
  let directoriesRead = 0
  for (let depth = 0; depth < plan.maxDepth && level.length > 0; depth += 1) {
    const nextLevel: string[] = []
    for (const dir of level) {
      if (directoriesRead >= ARTIFACT_GLOB_MAX_DIRECTORIES_READ) {
        return matches.sort()
      }
      directoriesRead += 1
      let entries: Awaited<ReturnType<WorkflowFilesystem['readDir']>>
      try {
        entries = await fs.readDir(
          dir ? joinWorktreeRelativePath(workspaceRoot, dir) : workspaceRoot
        )
      } catch {
        continue // Unreadable directories simply contribute no matches.
      }
      for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymlink) {
          continue
        }
        const relativePath = dir ? `${dir}/${entry.name}` : entry.name
        if (depth < plan.literalPrefix.length) {
          if (entry.isDirectory && entry.name === plan.literalPrefix[depth]) {
            nextLevel.push(relativePath)
          }
          continue
        }
        if (posix.matchesGlob(relativePath, plan.pattern)) {
          matches.push(relativePath)
          if (matches.length >= ARTIFACT_GLOB_MAX_MATCHES) {
            return matches.sort()
          }
        }
        if (entry.isDirectory && (plan.descendDotDirectories || !entry.name.startsWith('.'))) {
          nextLevel.push(relativePath)
        }
      }
    }
    level = nextLevel
  }
  return matches.sort()
}
