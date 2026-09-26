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

/** A start marker with no end marker after it is an orphan: only that line is ours to drop. */
function locateBlock(
  lines: readonly string[],
  runId: string
): { start: number; end: number } | { orphanStart: number } | undefined {
  const start = lines.indexOf(blockStart(runId))
  if (start === -1) {
    return undefined
  }
  const end = lines.indexOf(blockEnd(runId), start + 1)
  return end === -1 ? { orphanStart: start } : { start, end }
}

function withoutLine(lines: readonly string[], index: number): string[] {
  return [...lines.slice(0, index), ...lines.slice(index + 1)]
}

/** Adds `paths` to the run's block, creating it at the end of the file if needed. */
export function withRunExcludeEntries(
  content: string,
  runId: string,
  workspaceRelativePaths: readonly string[]
): string {
  let lines = splitLines(content)
  let block = locateBlock(lines, runId)
  if (block && 'orphanStart' in block) {
    lines = withoutLine(lines, block.orphanStart)
    block = undefined
  }
  const existing = block ? lines.slice(block.start + 1, block.end) : []
  const additions = workspaceRelativePaths
    .map(excludePatternFor)
    .filter((pattern, index, all) => !existing.includes(pattern) && all.indexOf(pattern) === index)
  if (additions.length === 0) {
    return content
  }
  if (!block) {
    return joinLines([...lines, blockStart(runId), ...additions, blockEnd(runId)])
  }
  return joinLines([...lines.slice(0, block.end), ...additions, ...lines.slice(block.end)])
}

/** Drops the run's whole block; everything else in the file is left byte-for-byte. */
export function withoutRunExcludeEntries(content: string, runId: string): string {
  const lines = splitLines(content)
  const block = locateBlock(lines, runId)
  if (!block) {
    return content
  }
  if ('orphanStart' in block) {
    return joinLines(withoutLine(lines, block.orphanStart))
  }
  return joinLines([...lines.slice(0, block.start), ...lines.slice(block.end + 1)])
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
