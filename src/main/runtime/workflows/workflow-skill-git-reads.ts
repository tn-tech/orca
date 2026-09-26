// Git reads a skill install needs, on whichever host runs the workspace's git. Both commands
// exist in Git 2.25 and pass the SSH relay's `git.exec` validator as sent.
import type { WorkflowSkillProvisioningPorts } from './workflow-skill-provisioning'

export type SkillGitHost = {
  /** Whether `<root>/.git` exists (a directory, or a linked worktree's file). */
  hasGitEntry(workspaceRoot: string): Promise<boolean>
  /** Stdout of git run in `workspaceRoot`; throws on a non-zero exit. */
  runGit(args: string[], workspaceRoot: string): Promise<string>
  /** Resolves a path git printed relative to `workspaceRoot` into a host path. */
  resolvePath(workspaceRoot: string, gitPath: string): string
}

export function skillGitReads(
  host: SkillGitHost
): Pick<WorkflowSkillProvisioningPorts, 'resolveGitExcludePath' | 'listTrackedPaths'> {
  return {
    /** `--git-path` (Git 2.5+) resolves a linked worktree's exclude file to the common git dir. */
    async resolveGitExcludePath(workspaceRoot) {
      if (!(await host.hasGitEntry(workspaceRoot))) {
        return null
      }
      const stdout = await host.runGit(['rev-parse', '--git-path', 'info/exclude'], workspaceRoot)
      return host.resolvePath(workspaceRoot, stdout.trim())
    },
    /** Which of `relativePaths` (files or directories) have tracked content; `[]` without git. */
    async listTrackedPaths(workspaceRoot, relativePaths) {
      if (relativePaths.length === 0 || !(await host.hasGitEntry(workspaceRoot))) {
        return []
      }
      const stdout = await host.runGit(['ls-files', '-z', '--', ...relativePaths], workspaceRoot)
      const tracked = stdout.split('\0').filter(Boolean)
      return relativePaths.filter((path) =>
        tracked.some((file) => file === path || file.startsWith(`${path}/`))
      )
    }
  }
}
