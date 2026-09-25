/**
 * Copies `sample-repo/` into a fresh temp directory, git-inits it, and commits
 * everything in one commit. Tests use this instead of the checked-in fixture
 * directly so each run gets an isolated, disposable repo.
 */

import { realpathSync } from 'node:fs'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '../../../src/shared/child-process/run-process'

const SAMPLE_REPO_SOURCE = join(__dirname, 'sample-repo')

export type SampleWorkflowRepo = {
  /** Absolute, symlink-resolved path to the temp git repo's root. */
  repoPath: string
}

async function runGit(args: string[], cwd: string): Promise<void> {
  const result = await runProcess({ program: 'git', args, cwd })
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`)
  }
}

export async function createSampleWorkflowRepo(): Promise<SampleWorkflowRepo> {
  // Why realpath: on macOS os.tmpdir() (/var/...) symlinks to /private/var/...,
  // and git normalizes paths through the real one, so comparisons against a
  // raw mkdtemp path would mismatch.
  const repoPath = realpathSync(await mkdtemp(join(tmpdir(), 'orca-workflow-sample-repo-')))
  await cp(SAMPLE_REPO_SOURCE, repoPath, { recursive: true })

  await runGit(['init'], repoPath)
  await runGit(['config', 'user.email', 'workflow-fixture@test.local'], repoPath)
  await runGit(['config', 'user.name', 'Workflow Fixture'], repoPath)
  await runGit(['add', '-A'], repoPath)
  await runGit(['commit', '-m', 'Initial commit for workflow sample repo'], repoPath)

  return { repoPath }
}
