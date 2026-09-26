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
import { validateWorkflowGraph } from '../../../../../shared/workflows/workflow-graph-validation'
import {
  deleteWorkflow,
  listWorkflows,
  readWorkflow,
  resolveWorkflowFilePath,
  writeWorkflow
} from '../../../workflows/workflow-file-store'
import {
  getRepoWorkflowSourceAllowlist,
  WORKFLOW_SOURCE_NOT_ALLOWED_CODE
} from '../../../workflows/workflow-source-allowlist'
import { agentSupportsModel } from './workflow-agent-catalog-support'
import { serializeWorkflowFile } from './workflow-file-serialization'
import {
  readNamedWorkflow,
  resolveWorkflowSource,
  withWorkflowNotFound
} from './workflow-source-resolution'

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
      if (!params.definition) {
        throw new Error('workflow_definition_required')
      }
      const repo = await runtime.showRepo(params.repo)
      const source = params.source ?? 'project'
      const allowlistedSources = await getRepoWorkflowSourceAllowlist(repo)
      const problems = validateWorkflowGraph(params.definition, {
        agentSupportsModel,
        allowlistedSources
      })
      // FR-015a: a non-allowlisted repository skill/role source refuses the save outright rather
      // than landing on disk as a reported "invalid" problem.
      if (problems.some((problem) => problem.code === 'graph_skill_source_not_allowlisted')) {
        throw new Error(WORKFLOW_SOURCE_NOT_ALLOWED_CODE)
      }
      const raw = serializeWorkflowFile(params.definition)
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
      if (!params.definition) {
        throw new Error('workflow_definition_required')
      }
      const repo = await runtime.showRepo(params.repo)
      const allowlistedSources = await getRepoWorkflowSourceAllowlist(repo)
      const problems = validateWorkflowGraph(params.definition, {
        agentSupportsModel,
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
      const newName = params.newName ?? ''
      try {
        const result = await writeWorkflow(repo, source, newName, original.raw, null)
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
    handler: notImplemented
  }),
  defineMethod({ name: 'workflow.draft', params: WorkflowDraft, handler: notImplemented })
]
