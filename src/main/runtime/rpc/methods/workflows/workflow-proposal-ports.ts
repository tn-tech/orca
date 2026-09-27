// Binds the role proposal actions (workflow-role-proposals.ts) to this runtime: the run's repo,
// its workflow file through the shared save gate, and its workspace on the execution host.
import type { RunSnapshot } from '../../../../../shared/workflows/workflow-run-types'
import type { RpcContext } from '../../core'
import { resolveRunWorkspaceAccess } from '../../../workflows/workflow-run-host-access'
import type {
  RoleProposalAcceptPorts,
  RoleProposalExportPorts
} from '../../../workflows/workflow-role-proposals'
import { getRoleFetchHost } from '../../../workflows/workflow-role-fetch-host'
import { fetchOriginRoleText } from '../../../workflows/workflow-role-origin-text'
import { getRepoWorkflowSourceAllowlist } from '../../../workflows/workflow-source-allowlist'
import { saveWorkflowDefinition } from './workflow-definition-save'
import { readNamedWorkflow } from './workflow-source-resolution'

type Runtime = RpcContext['runtime']

function runRepo(runtime: Runtime, run: RunSnapshot) {
  return runtime.showRepo(`id:${run.repoId}`)
}

export function roleProposalPorts(
  runtime: Runtime
): RoleProposalAcceptPorts & RoleProposalExportPorts {
  return {
    db: runtime.getOrchestrationDb(),
    notifier: runtime,
    readWorkflowFile: async (run) =>
      readNamedWorkflow(await runRepo(runtime, run), run.workflowName, run.workflowSource),
    saveWorkflowFile: async (run, definition, expectedRevision) =>
      saveWorkflowDefinition({
        repo: await runRepo(runtime, run),
        source: run.workflowSource,
        name: run.workflowName,
        definition,
        expectedRevision
      }),
    resolveWorkspace: async (run) =>
      resolveRunWorkspaceAccess(run, await runRepo(runtime, run), (selector) =>
        runtime.showManagedWorktree(selector)
      ),
    fetchOriginRoleText: async (run, roleId, origin) => {
      const repo = await runRepo(runtime, run)
      const allowlist = await getRepoWorkflowSourceAllowlist(repo).catch(() => [])
      return fetchOriginRoleText(roleId, origin, {
        getHost: () => getRoleFetchHost(repo),
        allowlist
      })
    }
  }
}
