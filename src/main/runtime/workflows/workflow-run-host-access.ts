// Where a run's nodes execute, resolved from the repo on every controller start: the run's host
// filesystem, its `.orca` ignore target, and the worktree id that worker placement resolves.
import type { Repo } from '../../../shared/repo-types'
import type { RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import { getRepoMainWorktreeId } from '../../../shared/worktree/id'
import {
  getSshFilesystemProvider,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../../providers/ssh-filesystem-dispatch'
import type { OrcaIgnoreTarget } from './workflow-brief-builder'
import {
  getProjectWorkflowFilesystem,
  type WorkflowFilesystem
} from './workflow-file-store-filesystem'
import type { WorkflowRunWorkspaceAccess } from './workflow-run-node-launch'
import { WORKFLOW_HOST_UNREACHABLE_CODE } from './workflow-run-workspace'

/** Normalizes the file store's own SSH-unavailable error to the one `isHostUnreachableError` and
 *  the rehydrate-retry path key on, so both fs resolution and ignore-target resolution agree. */
function projectWorkflowFilesystemOrUnreachable(repo: Repo): WorkflowFilesystem {
  try {
    return getProjectWorkflowFilesystem(repo)
  } catch (error) {
    if (error instanceof Error && error.message === SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE) {
      throw new Error(WORKFLOW_HOST_UNREACHABLE_CODE)
    }
    throw error
  }
}

function orcaIgnoreTargetFor(repo: Repo): OrcaIgnoreTarget {
  if (!repo.connectionId) {
    return { host: 'local', repoPath: repo.path }
  }
  const fsProvider = getSshFilesystemProvider(repo.connectionId)
  if (!fsProvider) {
    throw new Error(WORKFLOW_HOST_UNREACHABLE_CODE)
  }
  return { host: 'remote', fsProvider, repoPath: repo.path, connectionId: repo.connectionId }
}

export function isHostUnreachableError(error: unknown): boolean {
  return error instanceof Error && error.message === WORKFLOW_HOST_UNREACHABLE_CODE
}

/**
 * An in-place run places in the repo's own checkout (a git repo's main worktree, a folder repo's
 * root workspace). Derived from the repo, never the row: rows written before this fix stored the
 * bare repo id, which no worktree selector accepts.
 */
export async function resolveRunWorkspaceAccess(
  run: RunSnapshot,
  repo: Repo,
  showManagedWorktree: (selector: string) => Promise<{ id: string; path: string }>
): Promise<WorkflowRunWorkspaceAccess> {
  const fs = projectWorkflowFilesystemOrUnreachable(repo)
  const orcaIgnoreTarget = orcaIgnoreTargetFor(repo)
  if (run.workflowSnapshot.workspacePolicy === 'in-place') {
    return {
      worktreeId: getRepoMainWorktreeId(repo),
      workspaceRoot: repo.path,
      fs,
      orcaIgnoreTarget
    }
  }
  const worktree = await showManagedWorktree(`id:${run.worktreeId}`)
  return { worktreeId: worktree.id, workspaceRoot: worktree.path, fs, orcaIgnoreTarget }
}
