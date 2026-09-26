import { defineMethod } from '../../core'
import {
  WorkflowDelete,
  WorkflowDraft,
  WorkflowDuplicate,
  WorkflowImportRole,
  WorkflowList,
  WorkflowRead,
  WorkflowValidate,
  WorkflowWrite
} from '../../../../../shared/rpc-contract/workflow-params'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { validateWorkflowGraph } from '../../../../../shared/workflows/workflow-graph-validation'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import {
  deleteWorkflow,
  listWorkflows,
  readWorkflow,
  resolveWorkflowFilePath,
  writeWorkflow
} from '../../../workflows/workflow-file-store'
import { getRepoWorkflowSourceAllowlist } from '../../../workflows/workflow-source-allowlist'
import { agentSupportsModel, isKnownAgent } from './workflow-agent-catalog-support'
import { disallowedSourceProblems, throwSourceNotAllowedError } from './workflow-allowlist-refusal'
import { serializeWorkflowFile } from './workflow-file-serialization'
import { importRoleIntoRepo } from './workflow-role-import-method'
import {
  readNamedWorkflow,
  resolveWorkflowSource,
  withWorkflowNotFound
} from './workflow-source-resolution'

function requireDefinition<T>(definition: T | undefined, method: string): T {
  if (!definition) {
    throw new OrchestrationError('invalid_argument', `${method} requires a definition.`)
  }
  return definition
}

// Why: skeletons for U10; U10.5/US1/P3 units replace each throw with the real implementation.
function notImplemented(): never {
  throw new Error('workflow_not_implemented')
}

export const WORKFLOW_DEFINITION_METHODS = [
  defineMethod({
    name: 'workflow.list',
    params: WorkflowList,
    handler: async (params, { runtime }) => {
      const repo = await runtime.showRepo(params.repo)
      const entries = await listWorkflows(repo)
      const workflows = await Promise.all(
        entries.map(async (entry) => {
          // A per-entry read failure (e.g. a race with a concurrent delete, or an unreadable file)
          // degrades that one entry to invalid rather than failing the whole list.
          try {
            const [path, read] = await Promise.all([
              resolveWorkflowFilePath(repo, entry.source, entry.name),
              readWorkflow(repo, entry.source, entry.name)
            ])
            return {
              name: entry.name,
              source: entry.source,
              path,
              ...(read.definition?.description ? { description: read.definition.description } : {}),
              valid:
                read.definition !== undefined && read.problems.every((p) => p.severity !== 'error')
            }
          } catch {
            const path = await resolveWorkflowFilePath(repo, entry.source, entry.name).catch(
              () => ''
            )
            return { name: entry.name, source: entry.source, path, valid: false }
          }
        })
      )
      return { workflows }
    }
  }),
  defineMethod({
    name: 'workflow.read',
    params: WorkflowRead,
    handler: async (params, { runtime }) => {
      const repo = await runtime.showRepo(params.repo)
      const { source: _source, ...result } = await readNamedWorkflow(
        repo,
        params.name,
        params.source
      )
      return result
    }
  }),
  defineMethod({
    name: 'workflow.write',
    params: WorkflowWrite,
    handler: async (params, { runtime }) => {
      const definition = requireDefinition(params.definition, 'workflow.write')
      const repo = await runtime.showRepo(params.repo)
      const source = params.source ?? 'project'
      const allowlistedSources = await getRepoWorkflowSourceAllowlist(repo)
      const problems = validateWorkflowGraph(definition, {
        agentSupportsModel,
        isKnownAgent,
        allowlistedSources
      })
      // FR-015a: a non-allowlisted repository skill/role source refuses the save outright rather
      // than landing on disk as a reported "invalid" problem.
      if (disallowedSourceProblems(problems).length > 0) {
        throwSourceNotAllowedError(repo, definition, problems)
      }
      const raw = serializeWorkflowFile(definition)
      const result = await writeWorkflow(
        repo,
        source,
        params.name,
        raw,
        params.expectedRevision ?? null
      )
      return { revision: result.revision }
    }
  }),
  defineMethod({
    name: 'workflow.validate',
    params: WorkflowValidate,
    handler: async (params, { runtime }) => {
      const definition = requireDefinition(params.definition, 'workflow.validate')
      const repo = await runtime.showRepo(params.repo)
      const allowlistedSources = await getRepoWorkflowSourceAllowlist(repo)
      const problems = validateWorkflowGraph(definition, {
        agentSupportsModel,
        isKnownAgent,
        allowlistedSources
      })
      return { problems }
    }
  }),
  defineMethod({
    name: 'workflow.delete',
    params: WorkflowDelete,
    handler: async (params, { runtime }) => {
      const repo = await runtime.showRepo(params.repo)
      const source = await resolveWorkflowSource(repo, params.name, params.source)
      await withWorkflowNotFound(() => deleteWorkflow(repo, source, params.name))
      return {}
    }
  }),
  defineMethod({
    name: 'workflow.duplicate',
    params: WorkflowDuplicate,
    handler: async (params, { runtime }) => {
      const repo = await runtime.showRepo(params.repo)
      const source = await resolveWorkflowSource(repo, params.name, params.source)
      const original = await withWorkflowNotFound(() => readWorkflow(repo, source, params.name))
      if (!original.definition) {
        throw new OrchestrationError('workflow_invalid', 'workflow_invalid', {
          problems: original.problems
        })
      }
      const newName = params.newName ?? ''
      // The copy's file stem is newName; its declared name must match, or the two would disagree.
      const renamed: Workflow = { ...original.definition, name: newName }
      const allowlistedSources = await getRepoWorkflowSourceAllowlist(repo)
      const problems = validateWorkflowGraph(renamed, {
        agentSupportsModel,
        isKnownAgent,
        allowlistedSources
      })
      if (disallowedSourceProblems(problems).length > 0) {
        throwSourceNotAllowedError(repo, renamed, problems)
      }
      const raw = serializeWorkflowFile(renamed)
      try {
        const result = await writeWorkflow(repo, source, newName, raw, null)
        return { name: newName, revision: result.revision }
      } catch (error) {
        if (error instanceof Error && error.message === 'workflow_file_conflict') {
          throw new Error('workflow_name_taken')
        }
        throw error
      }
    }
  }),
  defineMethod({
    name: 'workflow.importRole',
    params: WorkflowImportRole,
    handler: async (params, { runtime }) => {
      const repo = await runtime.showRepo(params.repo)
      return importRoleIntoRepo(repo, params)
    }
  }),
  defineMethod({ name: 'workflow.draft', params: WorkflowDraft, handler: notImplemented })
]
