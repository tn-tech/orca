import type { Repo } from '../../../../../shared/repo-types'
import {
  listWorkflows,
  readWorkflow,
  type WorkflowFileReadResult,
  type WorkflowFileSource
} from '../../../workflows/workflow-file-store'

const FILE_NOT_FOUND_MESSAGE = 'workflow_file_not_found'
const NOT_FOUND_CODE = 'workflow_not_found'

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === FILE_NOT_FOUND_MESSAGE
}

/** The file store's per-file `workflow_file_not_found` is an implementation detail; the RPC
 *  contract's family-wide code is `workflow_not_found` (contracts/rpc-methods.md). */
export async function withWorkflowNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isFileNotFound(error)) {
      throw new Error(NOT_FOUND_CODE)
    }
    throw error
  }
}

/** Resolves which source holds `name` when the caller didn't say — project wins a name clash,
 *  matching `listWorkflows` (data-model.md §5). */
export async function resolveWorkflowSource(
  repo: Repo,
  name: string,
  source?: WorkflowFileSource
): Promise<WorkflowFileSource> {
  if (source) {
    return source
  }
  const entries = await listWorkflows(repo)
  const match = entries.find((entry) => entry.name === name)
  if (!match) {
    throw new Error(NOT_FOUND_CODE)
  }
  return match.source
}

/** Reads a workflow by name, resolving its source when the caller omitted it. */
export async function readNamedWorkflow(
  repo: Repo,
  name: string,
  source?: WorkflowFileSource
): Promise<WorkflowFileReadResult & { source: WorkflowFileSource }> {
  const resolvedSource = await resolveWorkflowSource(repo, name, source)
  const result = await withWorkflowNotFound(() => readWorkflow(repo, resolvedSource, name))
  return { ...result, source: resolvedSource }
}
