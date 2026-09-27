// Resolves a node's declared artifacts (literal paths or globs) against the run workspace for
// result capture (contracts/agent-brief.md "Engine validation on worker_done", spec.md FR-027).
import type { WorkflowAttemptArtifact } from '../../../shared/workflows/workflow-run-types'
import { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from '../runtime-relative-paths'
import {
  createArtifactGlobBudget,
  findArtifactGlobMatches,
  isArtifactGlob,
  type ArtifactGlobBudget,
  type ArtifactGlobTruncation
} from './workflow-artifact-glob'
import type { WorkflowFilesystem } from './workflow-file-store-filesystem'

export type ArtifactSpec = { path: string; required: boolean }

type GlobTruncation = { pattern: string; reason: ArtifactGlobTruncation }

export type ResolvedArtifacts = {
  artifacts: WorkflowAttemptArtifact[]
  missingRequired: boolean
  /** Globs that hit a limit but still matched. */
  truncations: GlobTruncation[]
  /** Set when a required glob hit a limit before any match, so absence is unproven. */
  missingDetail?: string
}

async function pathExists(fs: WorkflowFilesystem, absolutePath: string): Promise<boolean> {
  try {
    await fs.readFile(absolutePath)
    return true
  } catch (error) {
    if (error instanceof Error && error.message === 'workflow_file_binary') {
      return true // Binary files fail `readFile`'s SSH decode but do exist.
    }
  }
  try {
    await fs.readDir(absolutePath) // Artifacts may be directories (spec.md's Artifact glossary entry).
    return true
  } catch {
    return false
  }
}

function isWorkspaceEscape(error: unknown): boolean {
  return error instanceof Error && error.message === 'invalid_relative_path'
}

type SpecResolution = { found: WorkflowAttemptArtifact[]; truncated?: ArtifactGlobTruncation }

/**
 * An existing literal path wins, since names like `app/[id]/page.tsx` contain glob syntax; only
 * otherwise is a glob expanded into its concrete matches.
 */
async function resolveArtifactSpec(
  fs: WorkflowFilesystem,
  workspaceRoot: string,
  spec: ArtifactSpec,
  budget: ArtifactGlobBudget
): Promise<SpecResolution> {
  try {
    const normalized = normalizeRuntimeRelativePath(spec.path)
    if (await pathExists(fs, joinWorktreeRelativePath(workspaceRoot, normalized))) {
      return { found: [{ path: spec.path, exists: true }] }
    }
    if (isArtifactGlob(spec.path)) {
      const { matches, truncated } = await findArtifactGlobMatches(
        fs,
        workspaceRoot,
        spec.path,
        budget
      )
      return { found: matches.map((path) => ({ path, exists: true })), truncated }
    }
  } catch (error) {
    if (!isWorkspaceEscape(error)) {
      throw error
    }
    // Absolute or `..`: escapes the run workspace, so it never counts as present.
  }
  return { found: [] }
}

export async function resolveArtifacts(
  fs: WorkflowFilesystem,
  workspaceRoot: string,
  specs: readonly ArtifactSpec[],
  options: { remote?: boolean; signal?: AbortSignal } = {}
): Promise<ResolvedArtifacts> {
  const budget = createArtifactGlobBudget(options)
  const byPath = new Map<string, WorkflowAttemptArtifact>()
  const truncations: GlobTruncation[] = []
  const unproven: string[] = []
  let missingRequired = false
  for (const spec of specs) {
    const { found, truncated } = await resolveArtifactSpec(fs, workspaceRoot, spec, budget)
    if (found.length === 0) {
      missingRequired ||= spec.required
      if (truncated && spec.required) {
        unproven.push(`artifact glob "${spec.path}" stopped early (${truncated}) before any match`)
      }
    } else if (truncated) {
      truncations.push({ pattern: spec.path, reason: truncated })
    }
    const recorded = found.length > 0 ? found : [{ path: spec.path, exists: false }]
    for (const artifact of recorded) {
      // Why: a glob and a literal (or two globs) can name the same file; list it once, present.
      byPath.set(artifact.path, {
        path: artifact.path,
        exists: artifact.exists || !!byPath.get(artifact.path)?.exists
      })
    }
  }
  return {
    artifacts: [...byPath.values()],
    missingRequired,
    truncations,
    ...(unproven.length > 0 ? { missingDetail: unproven.join('; ') } : {})
  }
}
