import { describe, expect, it, vi } from 'vitest'
import { ExecutionHostNotDispatchableError } from '../../providers/execution-host-provider-dispatch'
import { SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE } from '../../providers/ssh-git-dispatch'
import {
  createRunWorkspace,
  resolveInPlaceWorkspace,
  WORKFLOW_HOST_UNREACHABLE_CODE,
  type RunWorkspaceCreatePort
} from './workflow-run-workspace'

const RUN = { id: 'wfr_00000000c001', workflowName: 'feature-with-qa', repoId: 'repo-1' }

describe('createRunWorkspace', () => {
  it('creates a worktree named <workflow>-<runId>, base and hooks left for the create path to resolve', async () => {
    const createManagedWorktree = vi.fn().mockResolvedValue({
      worktree: {
        id: 'repo-1::/tmp/wt',
        path: '/tmp/wt',
        branch: 'feature-with-qa-wfr_00000000c001'
      }
    })
    const port: RunWorkspaceCreatePort = { createManagedWorktree }

    const workspace = await createRunWorkspace(RUN, port)

    expect(createManagedWorktree).toHaveBeenCalledWith({
      repoSelector: 'id:repo-1',
      name: 'feature-with-qa-wfr_00000000c001'
    })
    expect(workspace).toEqual({
      worktreeId: 'repo-1::/tmp/wt',
      workspaceRoot: '/tmp/wt',
      branch: 'feature-with-qa-wfr_00000000c001'
    })
  })

  it('surfaces workflow_host_unreachable and creates nothing when the owning runtime host is not dispatchable', async () => {
    const port: RunWorkspaceCreatePort = {
      createManagedWorktree: vi
        .fn()
        .mockRejectedValue(new ExecutionHostNotDispatchableError('runtime:env-1'))
    }

    await expect(createRunWorkspace(RUN, port)).rejects.toThrow(WORKFLOW_HOST_UNREACHABLE_CODE)
  })

  it('surfaces workflow_host_unreachable when the SSH connection has dropped', async () => {
    const port: RunWorkspaceCreatePort = {
      createManagedWorktree: vi
        .fn()
        .mockRejectedValue(new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE))
    }

    await expect(createRunWorkspace(RUN, port)).rejects.toThrow(WORKFLOW_HOST_UNREACHABLE_CODE)
  })

  it('rethrows an unrelated create failure unchanged', async () => {
    const port: RunWorkspaceCreatePort = {
      createManagedWorktree: vi.fn().mockRejectedValue(new Error('disk full'))
    }

    await expect(createRunWorkspace(RUN, port)).rejects.toThrow('disk full')
  })
})

describe('resolveInPlaceWorkspace', () => {
  it('returns the folder repo path as the workspace root with no worktree created', () => {
    expect(resolveInPlaceWorkspace({ path: '/Users/me/project' })).toEqual({
      workspaceRoot: '/Users/me/project'
    })
  })
})
