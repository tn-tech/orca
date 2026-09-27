// Expands a declared artifact glob (contracts/agent-brief.md "required artifact globs") into the
// concrete workspace-relative paths it matches, walking only the run workspace's own filesystem
// provider (local, WSL or SSH). Symlinks are never matched or descended, so no match can resolve
// outside the workspace. The walk runs inside the controller's serial mailbox loop, so every
// limit below reports how it cut the walk short instead of truncating silently.
import { posix } from 'node:path'
import { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from '../runtime-relative-paths'
import type { WorkflowFilesystem } from './workflow-file-store-filesystem'

export const ARTIFACT_GLOB_MAX_MATCHES = 1000
/** Deepest path (in segments) a `**` pattern can match. */
export const ARTIFACT_GLOB_MAX_DEPTH = 32
export const ARTIFACT_GLOB_LOCAL_MAX_DIRECTORIES_READ = 5000
/** Each remote read is a sequential relay round trip that also competes with interactive fs calls. */
export const ARTIFACT_GLOB_REMOTE_MAX_DIRECTORIES_READ = 300
/** Wall-clock budget for all of one capture's glob walks. */
export const ARTIFACT_GLOB_TIME_BUDGET_MS = 10_000

export type ArtifactGlobTruncation = 'matches' | 'directories' | 'depth' | 'time' | 'aborted'

/** Shared by every glob of one capture, so many globs cannot multiply the budget. */
export type ArtifactGlobBudget = {
  directoriesRemaining: number
  deadline: number
  signal?: AbortSignal
}

export function createArtifactGlobBudget(
  options: { remote?: boolean; signal?: AbortSignal } = {}
): ArtifactGlobBudget {
  return {
    directoriesRemaining: options.remote
      ? ARTIFACT_GLOB_REMOTE_MAX_DIRECTORIES_READ
      : ARTIFACT_GLOB_LOCAL_MAX_DIRECTORIES_READ,
    deadline: Date.now() + ARTIFACT_GLOB_TIME_BUDGET_MS,
    ...(options.signal ? { signal: options.signal } : {})
  }
}

export type ArtifactGlobMatches = { matches: string[]; truncated?: ArtifactGlobTruncation }

const GLOB_SYNTAX = /[*?[\]{}]/

export function isArtifactGlob(path: string): boolean {
  return GLOB_SYNTAX.test(path)
}

type WalkPlan = {
  pattern: string
  segments: string[]
  /** Leading glob-free segments: only these exact names are descended at those depths. */
  literalPrefix: string[]
  firstGlobstar: number
  hasGlobstar: boolean
  /** Some segment after the first `**` names a dot entry explicitly. */
  dotTargetAfterGlobstar: boolean
}

function planWalk(pattern: string): WalkPlan {
  const normalized = normalizeRuntimeRelativePath(pattern)
  const segments = normalized.split('/')
  const firstGlob = segments.findIndex((segment) => GLOB_SYNTAX.test(segment))
  const globstarIndex = segments.findIndex((segment) => segment.includes('**'))
  const firstGlobstar = globstarIndex === -1 ? segments.length : globstarIndex
  return {
    pattern: normalized,
    segments,
    literalPrefix: segments.slice(0, firstGlob === -1 ? segments.length : firstGlob),
    firstGlobstar,
    hasGlobstar: globstarIndex !== -1,
    dotTargetAfterGlobstar: segments.slice(firstGlobstar + 1).some((s) => s.startsWith('.'))
  }
}

/** `*`/`**` never match a dot segment, so a dot directory is read only when the pattern names one. */
function mayDescendDotDirectory(plan: WalkPlan, name: string, depth: number): boolean {
  if (name === '.git') {
    return false
  }
  return depth < plan.firstGlobstar
    ? (plan.segments[depth]?.startsWith('.') ?? false)
    : plan.dotTargetAfterGlobstar
}

function byCodeUnit(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function budgetExhausted(budget: ArtifactGlobBudget): ArtifactGlobTruncation | undefined {
  if (budget.signal?.aborted) {
    return 'aborted'
  }
  if (Date.now() >= budget.deadline) {
    return 'time'
  }
  return budget.directoriesRemaining <= 0 ? 'directories' : undefined
}

/**
 * Workspace-relative forward-slash paths (files or directories) matching `pattern`, sorted.
 * `truncated` says which limit stopped the walk early. Throws `invalid_relative_path` for an
 * absolute or `..` pattern.
 */
export async function findArtifactGlobMatches(
  fs: WorkflowFilesystem,
  workspaceRoot: string,
  pattern: string,
  budget: ArtifactGlobBudget
): Promise<ArtifactGlobMatches> {
  const plan = planWalk(pattern)
  const matches: string[] = []
  const done = (truncated?: ArtifactGlobTruncation): ArtifactGlobMatches => ({
    matches: matches.sort(),
    ...(truncated ? { truncated } : {})
  })
  const maxDepth = plan.hasGlobstar ? ARTIFACT_GLOB_MAX_DEPTH : plan.segments.length
  let level: string[] = ['']
  for (let depth = 0; level.length > 0; depth += 1) {
    if (depth >= maxDepth) {
      return done(plan.hasGlobstar ? 'depth' : undefined)
    }
    const nextLevel: string[] = []
    for (const dir of level) {
      const exhausted = budgetExhausted(budget)
      if (exhausted) {
        return done(exhausted)
      }
      budget.directoriesRemaining -= 1
      let entries: Awaited<ReturnType<WorkflowFilesystem['readDir']>>
      try {
        entries = await fs.readDir(
          dir ? joinWorktreeRelativePath(workspaceRoot, dir) : workspaceRoot
        )
      } catch {
        continue // Unreadable directories simply contribute no matches.
      }
      for (const entry of entries.toSorted(byCodeUnit)) {
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
            return done('matches')
          }
        }
        if (
          entry.isDirectory &&
          (!entry.name.startsWith('.') || mayDescendDotDirectory(plan, entry.name, depth))
        ) {
          nextLevel.push(relativePath)
        }
      }
    }
    level = nextLevel
  }
  return done()
}
