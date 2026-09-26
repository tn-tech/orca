import type { z } from 'zod'
import type { Repo } from '../../../../../shared/repo-types'
import type { WorkflowImportRole } from '../../../../../shared/rpc-contract/workflow-params'
import type { Role } from '../../../../../shared/workflows/workflow-definition-types'
import { validateWorkflowGraph } from '../../../../../shared/workflows/workflow-graph-validation'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import { writeWorkflow } from '../../../workflows/workflow-file-store'
import { getRoleFetchHost } from '../../../workflows/workflow-role-fetch-host'
import {
  applyImportedRole,
  fetchRoleForImport,
  RoleSourceNotAllowedError,
  withImportedRole,
  type FetchedRole
} from '../../../workflows/workflow-role-import'
import { getRepoWorkflowSourceAllowlist } from '../../../workflows/workflow-source-allowlist'
import { agentSupportsModel, isKnownAgent } from './workflow-agent-catalog-support'
import {
  disallowedSourceProblems,
  throwRoleSourceNotAllowedError,
  throwSourceNotAllowedError
} from './workflow-allowlist-refusal'
import { serializeWorkflowFile } from './workflow-file-serialization'
import { readNamedWorkflow } from './workflow-source-resolution'

type ImportRoleParams = z.infer<typeof WorkflowImportRole>

async function fetchAllowlistedRole(
  repo: Repo,
  params: ImportRoleParams,
  allowlist: readonly string[]
): Promise<FetchedRole> {
  try {
    return await fetchRoleForImport(
      { source: params.source, roleName: params.roleName, version: params.version },
      { host: getRoleFetchHost(repo), allowlist, now: new Date() }
    )
  } catch (error) {
    if (error instanceof RoleSourceNotAllowedError) {
      throwRoleSourceNotAllowedError(repo, error.source)
    }
    throw error
  }
}

/** Copies the fetched role into the named workflow file; the write bumps its revision. */
async function importIntoWorkflow(
  repo: Repo,
  params: ImportRoleParams & { workflow: string },
  fetched: FetchedRole,
  allowlist: string[]
): Promise<{ role: Role; revision: string }> {
  const current = await readNamedWorkflow(repo, params.workflow, params.workflowSource)
  if (!current.definition) {
    throw new OrchestrationError('workflow_invalid', 'workflow_invalid', {
      problems: current.problems
    })
  }
  const { definition, role } = withImportedRole(current.definition, fetched)
  const problems = validateWorkflowGraph(definition, {
    agentSupportsModel,
    isKnownAgent,
    allowlistedSources: allowlist
  })
  if (disallowedSourceProblems(problems).length > 0) {
    throwSourceNotAllowedError(repo, definition, problems)
  }
  const result = await writeWorkflow(
    repo,
    current.source,
    params.workflow,
    serializeWorkflowFile(definition),
    params.expectedRevision ?? current.revision
  )
  return { role, revision: result.revision }
}

/** `workflow.importRole` (FR-015a, FR-016): allowlist check, fetch on the execution host, copy. */
export async function importRoleIntoRepo(
  repo: Repo,
  params: ImportRoleParams
): Promise<{ role: Role; revision?: string }> {
  const allowlist = await getRepoWorkflowSourceAllowlist(repo)
  const fetched = await fetchAllowlistedRole(repo, params, allowlist)
  if (params.workflow) {
    return importIntoWorkflow(repo, { ...params, workflow: params.workflow }, fetched, allowlist)
  }
  return { role: applyImportedRole(undefined, fetched) }
}
