import type { Repo } from '../repo-types'
import { isFolderRepo } from '../repo-kind'
import type { Workflow } from './workflow-definition-types'

/** Folder workspaces have no worktree to place a run in, so they always run in place (FR-041). */
export function effectiveWorkspacePolicy(
  repo: Pick<Repo, 'kind'>,
  saved: Workflow['workspacePolicy']
): Workflow['workspacePolicy'] {
  return isFolderRepo(repo) ? 'in-place' : saved
}

/** The definition a run actually executes: `workflow` with the repo-forced policy applied. */
export function withEffectiveWorkspacePolicy(
  workflow: Workflow,
  repo: Pick<Repo, 'kind'>
): Workflow {
  const workspacePolicy = effectiveWorkspacePolicy(repo, workflow.workspacePolicy)
  return workspacePolicy === workflow.workspacePolicy ? workflow : { ...workflow, workspacePolicy }
}
