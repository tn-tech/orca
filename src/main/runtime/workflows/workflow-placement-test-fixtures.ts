// A minimal in-memory RuntimeStore with one repo, enough for the runtime's real worktree and
// folder-workspace selectors to resolve that repo's own checkout.
import { join } from 'node:path'
import type { Repo } from '../../../shared/repo-types'
import type { WorktreeMeta } from '../../../shared/worktree/meta-types'
import type { RuntimeStore } from '../runtime-store-contract'

export function storeFor(repo: Repo): RuntimeStore {
  const meta: Record<string, WorktreeMeta> = {}
  return {
    getRepo: (id) => (id === repo.id ? repo : undefined),
    getRepos: () => [repo],
    addRepo: () => {},
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: placement never updates the repo; the return value is never read.
    updateRepo: () => undefined as never,
    getAllWorktreeMeta: () => meta,
    getWorktreeMeta: (id) => meta[id],
    setWorktreeMeta: (id, patch) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: folder-workspace listing only reads back the fields it just wrote.
      meta[id] = { ...meta[id], ...patch } as WorktreeMeta
      return meta[id]
    },
    removeWorktreeMeta: (id) => {
      delete meta[id]
    },
    getGitHubCache: () => ({ pr: {}, issue: {} }),
    getSettings: () => ({
      workspaceDir: join(repo.path, '..', 'workspaces'),
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    })
  }
}
