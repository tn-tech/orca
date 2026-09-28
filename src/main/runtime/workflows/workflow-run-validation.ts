// The start-time refusal every new run passes, whether started from a file or rerun (FR-030):
// graph problems and skill sources the repo's allowlist does not approve refuse the run.
import type { Repo } from '../../../shared/repo-types'
import type { GraphValidationContext } from '../../../shared/workflows/workflow-graph-validation'
import { validateWorkflowGraph } from '../../../shared/workflows/workflow-graph-validation'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import { WorkflowGraphValidationError } from './workflow-graph-validation-error'
import { assertRepoHostReachable } from './workflow-run-host-access'
import { getRepoWorkflowSourceAllowlist } from './workflow-source-allowlist'

export type WorkflowRunValidation = Pick<
  GraphValidationContext,
  'agentSupportsModel' | 'isKnownAgent'
>

export async function assertWorkflowRunnable(
  workflow: Workflow,
  repo: Repo,
  validation: WorkflowRunValidation
): Promise<void> {
  assertRepoHostReachable(repo)
  const allowlistedSources = await getRepoWorkflowSourceAllowlist(repo)
  const problems = validateWorkflowGraph(workflow, {
    agentSupportsModel: validation.agentSupportsModel,
    ...(validation.isKnownAgent ? { isKnownAgent: validation.isKnownAgent } : {}),
    allowlistedSources
  })
  if (problems.some((problem) => problem.severity === 'error')) {
    throw new WorkflowGraphValidationError(problems)
  }
}
