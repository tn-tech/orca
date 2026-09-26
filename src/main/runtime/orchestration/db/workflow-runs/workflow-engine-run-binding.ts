import {
  engineCoordinatorHandle,
  engineCoordinatorPaneKey
} from '../../../workflows/workflow-engine-principal'
import { OrchestrationError } from '../../orchestration-error'
import type { RunRow } from '../../types'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import { RUN_COLUMN_LIST } from '../row-column-lists'
import { exposeRunTimestamps } from '../utc-timestamp'
import { selectWorkflowRow } from './workflow-row-projection'

// ── Engine-owned orchestration Runs ──

const RUN_BY_WORKFLOW_RUN_SQL = `SELECT ${RUN_COLUMN_LIST} FROM runs
  WHERE workflow_run_id = ? AND legacy = 0 ORDER BY rowid LIMIT 1`

export function getRunForWorkflowRun(
  this: OrchestrationDb,
  workflowRunId: string
): RunRow | undefined {
  const run = selectWorkflowRow<RunRow>(this.db, RUN_BY_WORKFLOW_RUN_SQL, workflowRunId)
  return run ? exposeRunTimestamps(run) : undefined
}

/** One orchestration Run per workflow run, bound to the engine's synthetic coordinator identity. */
export function createWorkflowEngineRun(
  this: OrchestrationDb,
  params: { workflowRunId: string; objective: string }
): RunRow {
  const id = generateId('run')
  const coordinatorHandle = engineCoordinatorHandle(params.workflowRunId)
  this.db.exec('BEGIN IMMEDIATE')
  try {
    if (selectWorkflowRow<RunRow>(this.db, RUN_BY_WORKFLOW_RUN_SQL, params.workflowRunId)) {
      throw new OrchestrationError(
        'workflow_owned_run',
        `Workflow run ${params.workflowRunId} already owns an orchestration Run.`
      )
    }
    this.db
      .prepare(
        `INSERT INTO runs (
           id, objective, coordinator_handle, coordinator_pane_key,
           consumer_generation, legacy, workflow_run_id
         ) VALUES (?, ?, ?, ?, 1, 0, ?)`
      )
      .run(
        id,
        params.objective,
        coordinatorHandle,
        engineCoordinatorPaneKey(params.workflowRunId),
        params.workflowRunId
      )
    // Why: RunSnapshot.orchestrationRunId is what run views read; it can only be set once the Run exists.
    this.db
      .prepare('UPDATE workflow_runs SET orchestration_run_id = ? WHERE id = ?')
      .run(id, params.workflowRunId)
    this.rememberRunCoordinatorHandle(id, coordinatorHandle)
    this.db.exec('COMMIT')
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
  const run = this.getRun(id)
  if (!run) {
    throw new Error(`Run not found after insert: ${id}`)
  }
  return run
}

export type WorkflowEngineRunBindingMethods = {
  getRunForWorkflowRun: typeof getRunForWorkflowRun
  createWorkflowEngineRun: typeof createWorkflowEngineRun
}

export function attachWorkflowEngineRunBinding(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    getRunForWorkflowRun,
    createWorkflowEngineRun
  })
}
