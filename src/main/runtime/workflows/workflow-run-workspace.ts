// Creates a workflow run's own workspace: a fresh worktree via the existing `worktree.create`
// path for git-backed repos (FR-025, FR-038), or the project's own folder in place for folder
// workspaces (FR-041). Ports are injected so this stays testable without a real git repo/runtime.
import type { Repo } from '../../../shared/repo-types'
import type { RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import { ExecutionHostNotDispatchableError } from '../../providers/execution-host-provider-dispatch'
import { SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE } from '../../providers/ssh-git-dispatch'

export const WORKFLOW_HOST_UNREACHABLE_CODE = 'workflow_host_unreachable'

/** Minimal slice of `runtime.createManagedWorktree` — the same runtime method `worktree.create` calls. */
export type RunWorkspaceCreatePort = {
  createManagedWorktree(args: {
    repoSelector: string
    name: string
    baseBranch?: string
    runHooks?: boolean
    setupDecision?: 'run' | 'skip' | 'inherit'
  }): Promise<{ worktree: { id: string; path: string; branch: string } }>
}

export type RunWorkspace = {
  /** Absent for an in-place (folder) workspace: no worktree was created. */
  worktreeId?: string
  /** Absolute, host-appropriate root the engine writes node attempts under. */
  workspaceRoot: string
  branch?: string
}

/**
 * `ExecutionHostNotDispatchableError` fires for a `runtime:`-owned repo this process cannot
 * dispatch into; the SSH message fires when the repo's connection has dropped. Neither has a
 * local fallback (FR-038) — both become `workflow_host_unreachable` and create nothing here.
 */
function isWorktreeCreateHostUnreachable(error: unknown): boolean {
  return (
    error instanceof ExecutionHostNotDispatchableError ||
    (error instanceof Error && error.message === SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
  )
}

/**
 * Creates the run's workspace via the same path `worktree.create` uses: name
 * `<workflow>-<runId>`, `baseBranch` omitted so the create path resolves the project's default
 * branch itself, and `runHooks` omitted so the create path's own `runHooks ? 'run' :
 * (setupDecision ?? 'inherit')` rule lands on the repo's inherited setup-hook policy.
 */
export async function createRunWorkspace(
  run: Pick<RunSnapshot, 'id' | 'workflowName' | 'repoId'>,
  port: RunWorkspaceCreatePort,
  options: { skipSetup?: boolean } = {}
): Promise<RunWorkspace> {
  try {
    const { worktree } = await port.createManagedWorktree({
      repoSelector: `id:${run.repoId}`,
      name: `${run.workflowName}-${run.id}`,
      ...(options.skipSetup ? { setupDecision: 'skip' as const } : {})
    })
    return { worktreeId: worktree.id, workspaceRoot: worktree.path, branch: worktree.branch }
  } catch (error) {
    if (isWorktreeCreateHostUnreachable(error)) {
      throw new Error(WORKFLOW_HOST_UNREACHABLE_CODE)
    }
    throw error
  }
}

/** Folder workspaces run in place (FR-041, child workspaces disabled): no worktree is created. */
export function resolveInPlaceWorkspace(repo: Pick<Repo, 'path'>): RunWorkspace {
  return { workspaceRoot: repo.path }
}
