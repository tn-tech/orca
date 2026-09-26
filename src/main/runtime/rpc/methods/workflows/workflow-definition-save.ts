import type { Repo } from '../../../../../shared/repo-types'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { validateWorkflowGraph } from '../../../../../shared/workflows/workflow-graph-validation'
import {
  writeWorkflow,
  type WorkflowFileSource,
  type WorkflowFileWriteResult
} from '../../../workflows/workflow-file-store'
import { getRepoWorkflowSourceAllowlist } from '../../../workflows/workflow-source-allowlist'
import { agentSupportsModel, isKnownAgent } from './workflow-agent-catalog-support'
import { disallowedSourceProblems, throwSourceNotAllowedError } from './workflow-allowlist-refusal'
import { serializeWorkflowFile } from './workflow-file-serialization'

/**
 * The one save gate for a parsed definition: FR-015a refuses a non-allowlisted repository
 * skill/role source outright (rather than landing on disk as an "invalid" problem), then the file
 * is serialized and written with optimistic concurrency on `expectedRevision`.
 */
export async function saveWorkflowDefinition(input: {
  repo: Repo
  source: WorkflowFileSource
  name: string
  definition: Workflow
  expectedRevision: string | null
  allowlistedSources?: readonly string[]
}): Promise<WorkflowFileWriteResult> {
  const { repo, definition } = input
  const allowlistedSources =
    input.allowlistedSources ?? (await getRepoWorkflowSourceAllowlist(repo))
  const problems = validateWorkflowGraph(definition, {
    agentSupportsModel,
    isKnownAgent,
    allowlistedSources: [...allowlistedSources]
  })
  if (disallowedSourceProblems(problems).length > 0) {
    throwSourceNotAllowedError(repo, definition, problems)
  }
  return writeWorkflow(
    repo,
    input.source,
    input.name,
    serializeWorkflowFile(definition),
    input.expectedRevision
  )
}
