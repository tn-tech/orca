// Git reads a skill install needs on a local run workspace. Both commands exist in Git 2.25.
import { lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { isENOENT } from '../../ipc/filesystem-auth'

async function hasGitEntry(workspaceRoot: string): Promise<boolean> {
  try {
    await lstat(join(workspaceRoot, '.git'))
    return true
  } catch (error) {
    if (isENOENT(error)) {
      return false
    }
    throw error
  }
}

/** `--git-path` (Git 2.5+) resolves a linked worktree's exclude file to the common git dir. */
export async function resolveLocalGitExcludePath(workspaceRoot: string): Promise<string | null> {
  if (!(await hasGitEntry(workspaceRoot))) {
    return null
  }
  const { stdout } = await gitExecFileAsync(['rev-parse', '--git-path', 'info/exclude'], {
    cwd: workspaceRoot
  })
  return resolve(workspaceRoot, stdout.trim())
}

/** Which of `relativePaths` (files or directories) have tracked content; `[]` without git. */
export async function listLocalTrackedPaths(
  workspaceRoot: string,
  relativePaths: readonly string[]
): Promise<string[]> {
  if (relativePaths.length === 0 || !(await hasGitEntry(workspaceRoot))) {
    return []
  }
  const { stdout } = await gitExecFileAsync(['ls-files', '-z', '--', ...relativePaths], {
    cwd: workspaceRoot
  })
  const tracked = stdout.split('\0').filter(Boolean)
  return relativePaths.filter((path) =>
    tracked.some((file) => file === path || file.startsWith(`${path}/`))
  )
}
