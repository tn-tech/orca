import type { z } from 'zod'
import type { Repo } from '../../../../../shared/repo-types'
import type { WorkflowImportRole } from '../../../../../shared/rpc-contract/workflow-params'
import type { Role } from '../../../../../shared/workflows/workflow-definition-types'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import { getRoleFetchHost } from '../../../workflows/workflow-role-fetch-host'
import {
  fetchRoleForImport,
  RoleSourceNotAllowedError,
  type FetchedRole
} from '../../../workflows/workflow-role-import'
import {
  applyImportedRole,
  withImportedRole,
  type RoleImportMergeResult
} from '../../../workflows/workflow-role-import-merge'
import { getRepoWorkflowSourceAllowlist } from '../../../workflows/workflow-source-allowlist'
import { throwRoleSourceNotAllowedError } from './workflow-allowlist-refusal'
import { saveWorkflowDefinition } from './workflow-definition-save'
import { readNamedWorkflow } from './workflow-source-resolution'

type ImportRoleParams = z.infer<typeof WorkflowImportRole>

type ImportRoleResult = { role: Role; revision?: string; availableVersion?: string }

async function fetchAllowlistedRole(
  repo: Repo,
  params: ImportRoleParams,
  allowlist: readonly string[]
): Promise<FetchedRole> {
  try {
    return await fetchRoleForImport(
      { source: params.source, roleName: params.roleName, version: params.version },
      { getHost: () => getRoleFetchHost(repo), allowlist, now: new Date() }
    )
  } catch (error) {
    if (error instanceof RoleSourceNotAllowedError) {
      throwRoleSourceNotAllowedError(repo, error.source)
    }
    throw error
  }
}

function mergeResult(merged: RoleImportMergeResult, revision?: string): ImportRoleResult {
  return {
    role: merged.role,
    ...(revision !== undefined ? { revision } : {}),
    ...(merged.availableVersion !== undefined ? { availableVersion: merged.availableVersion } : {})
  }
}

/** Copies the fetched role into the named workflow file; the write bumps its revision. */
async function importIntoWorkflow(
  repo: Repo,
  params: ImportRoleParams & { workflow: string },
  fetched: FetchedRole,
  allowlist: readonly string[]
): Promise<ImportRoleResult> {
  const current = await readNamedWorkflow(repo, params.workflow, params.workflowSource)
  if (!current.definition) {
    throw new OrchestrationError('workflow_invalid', 'workflow_invalid', {
      problems: current.problems
    })
  }
  const merged = withImportedRole(current.definition, fetched, {
    overwriteLocal: params.overwriteLocal
  })
  const result = await saveWorkflowDefinition({
    repo,
    source: current.source,
    name: params.workflow,
    definition: merged.definition,
    expectedRevision: params.expectedRevision ?? current.revision,
    allowlistedSources: allowlist
  })
  return mergeResult(merged, result.revision)
}

/** `workflow.importRole` (FR-015a, FR-016): allowlist check, fetch on the execution host, copy. */
export async function importRoleIntoRepo(
  repo: Repo,
  params: ImportRoleParams
): Promise<ImportRoleResult> {
  const allowlist = await getRepoWorkflowSourceAllowlist(repo)
  const fetched = await fetchAllowlistedRole(repo, params, allowlist)
  if (params.workflow) {
    return importIntoWorkflow(repo, { ...params, workflow: params.workflow }, fetched, allowlist)
  }
  return mergeResult(applyImportedRole(undefined, fetched))
}
