import type { Repo } from '../../../../../shared/repo-types'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import { joinWorktreeRelativePath } from '../../../runtime-relative-paths'
import { WORKFLOW_SOURCE_NOT_ALLOWED_CODE } from '../../../workflows/workflow-source-allowlist'

const SKILL_SOURCE_NOT_ALLOWLISTED_CODE = 'graph_skill_source_not_allowlisted'

/** The `graph_skill_source_not_allowlisted` subset of `problems`, if any. */
export function disallowedSourceProblems(problems: readonly WorkflowProblem[]): WorkflowProblem[] {
  return problems.filter((problem) => problem.code === SKILL_SOURCE_NOT_ALLOWLISTED_CODE)
}

/**
 * FR-015a: refuses a definition referencing a repository skill/role source the project hasn't
 * allowlisted. Names which reference is disallowed (via the problems' own roleId/nodeId links and
 * messages) and where the allowlist lives, so a caller can fix `orca.yaml` instead of guessing.
 * Shared by `workflow.write`, `.duplicate` and `run.start`, whose refusal must read the same way
 * regardless of which one blocked the definition.
 */
export function throwSourceNotAllowedError(
  repo: Repo,
  definition: Workflow,
  problems: readonly WorkflowProblem[]
): never {
  const disallowed = disallowedSourceProblems(problems)
  const allowlistPath = joinWorktreeRelativePath(repo.path, 'orca.yaml')
  const detail = disallowed.map((problem) => problem.message).join(' ')
  throw new OrchestrationError(
    WORKFLOW_SOURCE_NOT_ALLOWED_CODE,
    `Workflow "${definition.name}" references a repository skill/role source that is not on the ` +
      `project allowlist. ${detail} Add it to workflows.allowedSources in ${allowlistPath}.`,
    { problems, allowlistPath }
  )
}
