import { defineMethod } from '../../core'
import {
  WorkflowRunControl,
  WorkflowRunEvents,
  WorkflowRunList,
  WorkflowRunReadNodeOutput,
  WorkflowRunRerun,
  WorkflowRunShow,
  WorkflowRunStart
} from '../../../../../shared/rpc-contract/workflow-run-params'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import { WorkflowGraphValidationError } from '../../../workflows/workflow-engine'
import { readWorkerOutput } from '../orchestration/worker/worker-control'
import { agentSupportsModel, isKnownAgent } from './workflow-agent-catalog-support'
import { disallowedSourceProblems, throwSourceNotAllowedError } from './workflow-allowlist-refusal'
import { workflowCallerIdentity } from './workflow-caller-identity'
import { readNamedWorkflow } from './workflow-source-resolution'
import { assertRepoHostReachable } from '../../../workflows/workflow-run-host-access'
import { startRerun } from '../../../workflows/workflow-rerun'
import { pauseWorkflowRun, resumeWorkflowRun } from '../../../workflows/workflow-run-control'
import type { Repo } from '../../../../../shared/repo-types'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'

/** A start-time refusal (graph problems, a non-allowlisted source) in its wire shape. */
function rethrowRunRefusal(error: unknown, repo: Repo, workflow: Workflow): never {
  if (error instanceof WorkflowGraphValidationError) {
    if (disallowedSourceProblems(error.problems).length > 0) {
      throwSourceNotAllowedError(repo, workflow, error.problems)
    }
    throw new OrchestrationError('workflow_invalid', 'workflow_invalid', {
      problems: error.problems
    })
  }
  throw error
}

export const WORKFLOW_RUN_METHODS = [
  defineMethod({
    name: 'workflow.run.start',
    params: WorkflowRunStart,
    handler: async (params, ctx) => {
      const { runtime } = ctx
      const repo = await runtime.showRepo(params.repo)
      assertRepoHostReachable(repo)
      const named = await readNamedWorkflow(repo, params.name, params.source)
      if (!named.definition) {
        throw new OrchestrationError('workflow_invalid', 'workflow_invalid', {
          problems: named.problems
        })
      }
      try {
        const run = await runtime.getWorkflowEngine().startRun({
          workflow: named.definition,
          workflowSource: named.source,
          workflowVersion: named.revision,
          objective: params.objective ?? '',
          repo,
          startedByClient: workflowCallerIdentity(ctx),
          ...(params.overrides?.concurrencyLimit !== undefined
            ? { concurrencyLimit: params.overrides.concurrencyLimit }
            : {}),
          validation: { agentSupportsModel, isKnownAgent }
        })
        return { runId: run.id }
      } catch (error) {
        rethrowRunRefusal(error, repo, named.definition)
      }
    }
  }),
  defineMethod({
    name: 'workflow.run.list',
    params: WorkflowRunList,
    handler: async (params, { runtime }) => {
      const repoId = params.repo ? (await runtime.showRepo(params.repo)).id : undefined
      const { runs, nextCursor } = runtime.getOrchestrationDb().listWorkflowRuns({
        ...(repoId ? { repoId } : {}),
        ...(params.name ? { name: params.name } : {}),
        ...(params.state ? { state: params.state } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
        ...(params.limit ? { limit: params.limit } : {})
      })
      return { runs, ...(nextCursor ? { nextCursor } : {}) }
    }
  }),
  defineMethod({
    name: 'workflow.run.show',
    params: WorkflowRunShow,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const run = db.getWorkflowRun(params.runId)
      if (!run) {
        throw new Error('workflow_not_found')
      }
      return {
        ...run,
        attempts: db.listWorkflowAttempts(params.runId),
        questions: db.listWorkflowQuestions(params.runId),
        messages: db.listWorkflowMessages(params.runId),
        events: db.listWorkflowEventsTail(params.runId),
        proposals: db.listWorkflowRoleProposals(params.runId)
      }
    }
  }),
  defineMethod({
    name: 'workflow.run.pause',
    params: WorkflowRunControl,
    handler: (params, { runtime }) => ({
      state: pauseWorkflowRun(runtime.getOrchestrationDb(), runtime, params.runId)
    })
  }),
  defineMethod({
    name: 'workflow.run.resume',
    params: WorkflowRunControl,
    handler: (params, { runtime }) => ({
      state: resumeWorkflowRun(runtime.getOrchestrationDb(), runtime, params.runId)
    })
  }),
  defineMethod({
    name: 'workflow.run.cancel',
    params: WorkflowRunControl,
    handler: async (params, { runtime }) => ({
      state: await runtime.cancelWorkflowRun(params.runId)
    })
  }),
  defineMethod({
    name: 'workflow.run.rerun',
    params: WorkflowRunRerun,
    handler: async (params, ctx) => {
      const { runtime } = ctx
      const engine = runtime.getWorkflowEngine()
      const db = runtime.getOrchestrationDb()
      let repo: Repo | undefined
      try {
        const rerun = await startRerun(
          {
            db,
            launch: (run) => engine.launch(run),
            resolveRepo: async (repoId) => {
              repo = await runtime.showRepo(`id:${repoId}`)
              return repo
            },
            showManagedWorktree: (selector) => runtime.showManagedWorktree(selector),
            validation: { agentSupportsModel, isKnownAgent }
          },
          {
            runId: params.runId,
            ...(params.fromNodeId ? { fromNodeId: params.fromNodeId } : {}),
            startedByClient: workflowCallerIdentity(ctx)
          }
        )
        return { runId: rerun.id }
      } catch (error) {
        const source = db.getWorkflowRun(params.runId)
        if (repo && source) {
          rethrowRunRefusal(error, repo, source.workflowSnapshot)
        }
        throw error
      }
    }
  }),
  defineMethod({
    name: 'workflow.run.readNodeOutput',
    params: WorkflowRunReadNodeOutput,
    handler: async (params, ctx) => {
      const db = ctx.runtime.getOrchestrationDb()
      if (!db.getWorkflowRun(params.runId)) {
        throw new Error('workflow_not_found')
      }
      const attempt = db
        .listWorkflowAttempts(params.runId)
        .find((candidate) => candidate.id === params.attemptId)
      if (!attempt?.dispatchId) {
        throw new OrchestrationError(
          'dispatch_not_found',
          `Node attempt ${params.attemptId} has no dispatch to read.`
        )
      }
      // Delegates straight to the same function orchestration.workerRead registers, rather than
      // through the dispatcher — that would import the full method registry, which includes this
      // module, forming an import cycle.
      return readWorkerOutput(
        {
          dispatch: attempt.dispatchId,
          cursor: params.cursor,
          limit: params.limit
        },
        ctx
      )
    }
  }),
  defineMethod({
    name: 'workflow.run.events',
    params: WorkflowRunEvents,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      if (!db.getWorkflowRun(params.runId)) {
        throw new Error('workflow_not_found')
      }
      const afterSeq = params.afterSeq ?? 0
      const events = db.listWorkflowEvents(params.runId, afterSeq, params.limit)
      const lastEvent = events.at(-1)
      return { events, nextSeq: lastEvent ? Number(lastEvent.id) : afterSeq }
    }
  })
]
