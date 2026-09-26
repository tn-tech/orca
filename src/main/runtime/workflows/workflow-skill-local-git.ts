// Git reads a skill install needs on a local run workspace.
import { lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { isENOENT } from '../../ipc/filesystem-auth'
import { skillGitReads } from './workflow-skill-git-reads'

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

const localGitReads = skillGitReads({
  hasGitEntry,
  async runGit(args, workspaceRoot) {
    const { stdout } = await gitExecFileAsync(args, { cwd: workspaceRoot })
    return stdout
  },
  resolvePath: (workspaceRoot, gitPath) => resolve(workspaceRoot, gitPath)
})

export const resolveLocalGitExcludePath = localGitReads.resolveGitExcludePath
export const listLocalTrackedPaths = localGitReads.listTrackedPaths
