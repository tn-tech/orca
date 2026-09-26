// Per-path `.git/info/exclude` entries for files a workflow run installs (FR-021, research R9).
// Exact paths, never directory globs, so committed skills such as `.claude/skills/speckit-*` stay
// visible. Each run owns a marked block: `info/exclude` lives in the common git dir, so every
// worktree of the repo shares it and one run's cleanup must not drop another run's entries.
import { runKeyedSerializedOperation } from '../../cli/keyed-promise-queue'

export type GitExcludeFileAccess = {
  /** `null` when the file does not exist. */
  readText(path: string): Promise<string | null>
  /** Creates missing parent directories. */
  writeText(path: string, content: string): Promise<void>
}

const excludeFileQueues = new Map<string, Promise<void>>()

function blockStart(runId: string): string {
  return `# >>> orca workflow run ${runId}`
}

function blockEnd(runId: string): string {
  return `# <<< orca workflow run ${runId}`
}

/** Anchored to the worktree root so `/.claude/skills/x` never matches a nested `.claude`. */
export function excludePatternFor(workspaceRelativePath: string): string {
  return `/${workspaceRelativePath.replace(/\\/g, '/').replace(/^\/+/, '')}`
}

function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/)
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines
}

function joinLines(lines: readonly string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

function locateBlock(lines: readonly string[], runId: string): { start: number; end: number } {
  const start = lines.indexOf(blockStart(runId))
  if (start === -1) {
    return { start: -1, end: -1 }
  }
  const end = lines.indexOf(blockEnd(runId), start + 1)
  return { start, end: end === -1 ? lines.length - 1 : end }
}

/** Adds `paths` to the run's block, creating it at the end of the file if needed. */
export function withRunExcludeEntries(
  content: string,
  runId: string,
  workspaceRelativePaths: readonly string[]
): string {
  const lines = splitLines(content)
  const { start, end } = locateBlock(lines, runId)
  const existing = start === -1 ? [] : lines.slice(start + 1, end)
  const additions = workspaceRelativePaths
    .map(excludePatternFor)
    .filter((pattern, index, all) => !existing.includes(pattern) && all.indexOf(pattern) === index)
  if (additions.length === 0) {
    return content
  }
  if (start === -1) {
    return joinLines([...lines, blockStart(runId), ...additions, blockEnd(runId)])
  }
  return joinLines([...lines.slice(0, end), ...additions, ...lines.slice(end)])
}

/** Drops the run's whole block; everything else in the file is left byte-for-byte. */
export function withoutRunExcludeEntries(content: string, runId: string): string {
  const lines = splitLines(content)
  const { start, end } = locateBlock(lines, runId)
  if (start === -1) {
    return content
  }
  return joinLines([...lines.slice(0, start), ...lines.slice(end + 1)])
}

export function appendRunExcludeEntries(
  excludePath: string,
  runId: string,
  workspaceRelativePaths: readonly string[],
  access: GitExcludeFileAccess
): Promise<void> {
  return runKeyedSerializedOperation(excludeFileQueues, excludePath, async () => {
    const content = (await access.readText(excludePath)) ?? ''
    const next = withRunExcludeEntries(content, runId, workspaceRelativePaths)
    if (next !== content) {
      await access.writeText(excludePath, next)
    }
  })
}

export function removeRunExcludeEntries(
  excludePath: string,
  runId: string,
  access: GitExcludeFileAccess
): Promise<void> {
  return runKeyedSerializedOperation(excludeFileQueues, excludePath, async () => {
    const content = await access.readText(excludePath)
    if (content === null) {
      return
    }
    const next = withoutRunExcludeEntries(content, runId)
    if (next !== content) {
      await access.writeText(excludePath, next)
    }
  })
}
