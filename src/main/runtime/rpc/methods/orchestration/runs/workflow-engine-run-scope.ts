import type { OrchestrationDb } from '../../../../orchestration/db'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import type { RunRow } from '../../../../orchestration/types'
import {
  asWorkflowEnginePrincipal,
  engineCoordinatorHandle,
  engineCoordinatorPaneKey,
  type OrchestrationPrincipal,
  type WorkflowEnginePrincipal
} from '../../../../workflows/workflow-engine-principal'

// Why: a CLI run-use/check on the engine's Run would fence the engine or steal its mailbox waiter.
export function assertTerminalMayMutateRun(run: RunRow | undefined): void {
  if (run?.workflow_run_id) {
    throw new OrchestrationError(
      'workflow_owned_run',
      `Run ${run.id} is owned by workflow run ${run.workflow_run_id}; terminal callers cannot change it. No effects were applied.`,
      { effectsApplied: false, workflowRunId: run.workflow_run_id }
    )
  }
}

function assertEngineHandle(
  principal: WorkflowEnginePrincipal,
  callerTerminalHandle: string | undefined
): void {
  if (
    callerTerminalHandle !== undefined &&
    callerTerminalHandle !== engineCoordinatorHandle(principal.workflowRunId)
  ) {
    throw new OrchestrationError(
      'consumer_fenced',
      `The workflow engine for ${principal.workflowRunId} cannot act as ${callerTerminalHandle}.`,
      { effectsApplied: false }
    )
  }
}

/** The engine's caller pane is its synthetic coordinator pane key, never a live terminal's. */
export function resolveWorkflowEngineCallerPane(
  principal: WorkflowEnginePrincipal,
  callerTerminalHandle: string
): string {
  assertEngineHandle(principal, callerTerminalHandle)
  return engineCoordinatorPaneKey(principal.workflowRunId)
}

/** An engine principal may only ever address the Run bound to its own workflow run. */
export function resolveWorkflowEngineRunScope(
  db: OrchestrationDb,
  principal: WorkflowEnginePrincipal,
  params: { explicit: RunRow | undefined; callerTerminalHandle: string | undefined }
): RunRow {
  assertEngineHandle(principal, params.callerTerminalHandle)
  const bound = db.getRunForWorkflowRun(principal.workflowRunId)
  if (!bound) {
    throw new OrchestrationError(
      'run_required',
      `No orchestration Run is bound to workflow run ${principal.workflowRunId}. No effects were applied.`
    )
  }
  if (bound.coordinator_pane_key !== engineCoordinatorPaneKey(principal.workflowRunId)) {
    throw new OrchestrationError(
      'consumer_fenced',
      `Run ${bound.id} is no longer bound to the workflow engine.`
    )
  }
  if (params.explicit && params.explicit.id !== bound.id) {
    throw new OrchestrationError(
      'consumer_fenced',
      `The workflow engine is bound to ${bound.id}, not ${params.explicit.id}.`
    )
  }
  return bound
}

/** Dispatch-keyed verbs: terminals may not touch an engine-owned Run; the engine only its own. */
export function assertCallerMayMutateDispatch(
  db: OrchestrationDb,
  dispatchId: string,
  principal: OrchestrationPrincipal | undefined
): void {
  // Why: some federated handler tests drive these verbs with partial DB fakes lacking this lookup.
  const lookup: OrchestrationDb['getDispatchContextById'] | undefined = db.getDispatchContextById
  const runId = lookup?.call(db, dispatchId)?.run_id
  const run = runId ? db.getRun(runId) : undefined
  const engine = asWorkflowEnginePrincipal(principal)
  if (!engine) {
    assertTerminalMayMutateRun(run)
    return
  }
  if (run && run.workflow_run_id !== engine.workflowRunId) {
    throw new OrchestrationError(
      'consumer_fenced',
      `Dispatch ${dispatchId} is not in the Run owned by workflow run ${engine.workflowRunId}.`,
      { effectsApplied: false }
    )
  }
}

// Why: reset wipes Runs, Tasks and mailboxes an active workflow run is still driving.
export function assertNoActiveWorkflowEngineRuns(db: OrchestrationDb): void {
  const active = db.listActiveWorkflowRuns().find((run) => db.getRunForWorkflowRun(run.id))
  if (active) {
    throw new OrchestrationError(
      'workflow_owned_run',
      `Workflow run ${active.id} is still active and owns orchestration state. Stop it with \`orca workflows cancel ${active.id}\` before resetting. No effects were applied.`,
      { effectsApplied: false, workflowRunId: active.id }
    )
  }
}
