import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { defineMethod } from '../../../core'
import { startFederatedWorker } from '../federation/federated-worker-start'
import { startLocalWorker } from './local-worker-start'
import {
  decideWorkerStartMode,
  readWorkerStartModeSettings
} from '../../orchestration-worker-start-mode'
import { resolveOrchestrationCaller, resolveRunScope } from '../runs/run-scope'
import { assertTerminalMayMutateRun } from '../runs/workflow-engine-run-scope'
import { asWorkflowEnginePrincipal } from '../../../../workflows/workflow-engine-principal'
import { assertWorkflowEngineWorkerStart } from './workflow-engine-worker-start'
import { WorkerStartParams } from './worker-start-schema'
import {
  isWorkerStartTimeoutWithinTimerLimit,
  resolveWorkerStartReadinessTimeoutMs
} from '../../../../../../shared/orchestration-timing-budgets'
import { assertWorkerStartTaskSpecWithinPromptBudget } from './worker-start-prompt-budget'

export const ORCHESTRATION_WORKER_START_METHODS = [
  defineMethod({
    name: 'orchestration.workerStart',
    params: WorkerStartParams,
    handler: async (
      params,
      { runtime, orchestrationMutation, orchestrationCompatibilityEvidence, principal }
    ) => {
      if (!isWorkerStartTimeoutWithinTimerLimit(params.timeoutMs)) {
        throw new OrchestrationError(
          'invalid_argument',
          '--timeout-ms is too large for worker-start transport grace; the derived timeout must fit within the timer limit.'
        )
      }
      const readinessTimeoutMs = resolveWorkerStartReadinessTimeoutMs(params.timeoutMs)
      const db = runtime.getOrchestrationDb()
      const engine = asWorkflowEnginePrincipal(principal)
      const workflowEngine = engine ? assertWorkflowEngineWorkerStart(params, engine) : undefined
      const coordinatorPane = resolveOrchestrationCaller(runtime, {
        callerTerminalHandle: params.from,
        callerEvidence: orchestrationCompatibilityEvidence,
        principal
      })
      if (!engine && params.run) {
        assertTerminalMayMutateRun(db.getRun(params.run))
      }
      const run = engine
        ? resolveRunScope(runtime, {
            runId: params.run,
            callerTerminalHandle: params.from,
            requireCurrentConsumer: true,
            principal
          })
        : coordinatorPane
          ? db.getCurrentRunForPane(coordinatorPane)
          : undefined
      if (!engine) {
        assertTerminalMayMutateRun(run)
      }
      if (!run || (params.run && params.run !== run.id)) {
        throw new OrchestrationError(
          'consumer_fenced',
          'worker-start requires the coordinator terminal currently bound to the Task Run.'
        )
      }
      const existingTask = params.task ? db.getTask(params.task) : undefined
      if (params.task && (!existingTask || existingTask.run_id !== run.id)) {
        throw new OrchestrationError(
          'task_not_found',
          `Task ${params.task} was not found in Run ${run.id}.`
        )
      }
      await assertWorkerStartTaskSpecWithinPromptBudget(params.spec ?? existingTask!.spec)
      const mode = decideWorkerStartMode({
        params,
        settings: readWorkerStartModeSettings(runtime)
      })
      if (params.on) {
        // A remote worker is always a terminal agent; the mode receipt rides along so the
        // coordinator still learns why its structured default did not apply.
        const receipt = await startFederatedWorker({
          params,
          runtime,
          db,
          runId: run.id,
          task: existingTask,
          orchestrationMutation
        })
        return receipt && typeof receipt === 'object' ? { ...receipt, mode } : receipt
      }
      return startLocalWorker({
        params: { ...params, timeoutMs: readinessTimeoutMs },
        runtime,
        db,
        run,
        coordinatorPane,
        existingTask,
        orchestrationMutation,
        mode,
        workflowEngine
      })
    }
  })
]
