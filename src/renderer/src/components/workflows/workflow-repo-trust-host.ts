// The editor (RoleEditor's Trust dialog, FR-018a) has no run workspace yet, only the open repo —
// so it derives the same trust host key the engine derives from a run's actual workspace root
// (workflow-trust-host-key.ts), from the repo's own path and SSH binding instead.
import {
  LOCAL_TRUST_HOST,
  workflowTrustHostKey
} from '../../../../shared/workflows/workflow-trust-host-key'
import type { Repo } from '../../../../shared/repo-types'

export function repoTrustHostKey(repo: Pick<Repo, 'path' | 'connectionId'> | null): string {
  if (!repo) {
    return LOCAL_TRUST_HOST
  }
  return workflowTrustHostKey({
    workspaceRoot: repo.path,
    orcaIgnoreTarget: repo.connectionId
      ? { host: 'remote', connectionId: repo.connectionId }
      : { host: 'local' }
  })
}
