import type { Node } from '../../../../../shared/workflows/workflow-definition-types'
import { canTransition } from '../../../../../shared/workflows/workflow-node-states'
import type {
  NodeAttemptView,
  WorkflowAttemptArtifact,
  WorkflowLaunchReceipt,
  WorkflowTranscriptRef
} from '../../../../../shared/workflows/workflow-run-types'
import type { WorkflowAttemptState } from '../../../../../shared/workflows/workflow-node-states'
import type { JsonValue } from '../../../../../shared/workflows/workflow-condition-schema'
import { OrchestrationError } from '../../orchestration-error'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import { selectWorkflowRow, selectWorkflowRows } from './workflow-row-projection'

// ── Workflow Node Attempts ──

const WORKFLOW_ATTEMPT_TERMINAL_STATES = new Set<WorkflowAttemptState>([
  'completed',
  'failed',
  'skipped',
  'cancelled'
])

type WorkflowNodeAttemptRow = {
  id: string
  run_id: string
  node_id: string
  node_type: string
  iteration: number
  attempt_index: number
  task_id: string | null
  dispatch_id: string | null
  state: WorkflowAttemptState
  requested_launch: string | null
  effective_launch: string | null
  brief_path: string | null
  result_path: string | null
  result_json: string | null
  artifacts_json: string
  failure_reason: string | null
  workspace_worktree_id: string | null
  transcript_ref: string | null
  started_at: number | null
  finished_at: number | null
}

function selectAttemptRow(
  db: OrchestrationDb['db'],
  id: string
): WorkflowNodeAttemptRow | undefined {
  return selectWorkflowRow<WorkflowNodeAttemptRow>(
    db,
    'SELECT * FROM workflow_node_attempts WHERE id = ?',
    id
  )
}

function toAttemptView(row: WorkflowNodeAttemptRow): NodeAttemptView {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: node_type is written only from Node['type'] by createWorkflowAttempt.
    nodeType: row.node_type as Node['type'],
    iteration: row.iteration,
    attemptIndex: row.attempt_index,
    taskId: row.task_id ?? undefined,
    dispatchId: row.dispatch_id ?? undefined,
    state: row.state,
    requestedLaunch: row.requested_launch ? JSON.parse(row.requested_launch) : undefined,
    effectiveLaunch: row.effective_launch ? JSON.parse(row.effective_launch) : undefined,
    briefPath: row.brief_path ?? undefined,
    resultPath: row.result_path ?? undefined,
    resultJson: row.result_json ? JSON.parse(row.result_json) : undefined,
    artifactsJson: JSON.parse(row.artifacts_json),
    failureReason: row.failure_reason ?? undefined,
    workspaceWorktreeId: row.workspace_worktree_id ?? undefined,
    transcriptRef: row.transcript_ref ? JSON.parse(row.transcript_ref) : undefined,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : undefined,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : undefined
  }
}

export function createWorkflowAttempt(
  this: OrchestrationDb,
  params: {
    runId: string
    nodeId: string
    nodeType: Node['type']
    iteration?: number
    attemptIndex?: number
  }
): NodeAttemptView {
  if (!this.getWorkflowRun(params.runId)) {
    throw new OrchestrationError(
      'workflow_run_not_found',
      `Workflow run ${params.runId} was not found while creating a node attempt.`,
      { runId: params.runId }
    )
  }
  const id = generateId('wfa')
  this.db
    .prepare(
      `INSERT INTO workflow_node_attempts (
         id, run_id, node_id, node_type, iteration, attempt_index
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.runId,
      params.nodeId,
      params.nodeType,
      params.iteration ?? 0,
      params.attemptIndex ?? 0
    )
  const row = selectAttemptRow(this.db, id)
  if (!row) {
    throw new Error(`Node attempt ${id} was not found immediately after insert.`)
  }
  return toAttemptView(row)
}

export function updateWorkflowAttempt(
  this: OrchestrationDb,
  id: string,
  patch: {
    taskId?: string
    dispatchId?: string
    requestedLaunch?: WorkflowLaunchReceipt
    effectiveLaunch?: WorkflowLaunchReceipt
    briefPath?: string
    resultPath?: string
    resultJson?: JsonValue
    artifactsJson?: WorkflowAttemptArtifact[]
    failureReason?: string
    workspaceWorktreeId?: string
    transcriptRef?: WorkflowTranscriptRef
  }
): NodeAttemptView | undefined {
  this.db
    .prepare(
      `UPDATE workflow_node_attempts SET
         task_id = COALESCE(?, task_id),
         dispatch_id = COALESCE(?, dispatch_id),
         requested_launch = COALESCE(?, requested_launch),
         effective_launch = COALESCE(?, effective_launch),
         brief_path = COALESCE(?, brief_path),
         result_path = COALESCE(?, result_path),
         result_json = COALESCE(?, result_json),
         artifacts_json = COALESCE(?, artifacts_json),
         failure_reason = COALESCE(?, failure_reason),
         workspace_worktree_id = COALESCE(?, workspace_worktree_id),
         transcript_ref = COALESCE(?, transcript_ref)
       WHERE id = ?`
    )
    .run(
      patch.taskId ?? null,
      patch.dispatchId ?? null,
      patch.requestedLaunch ? JSON.stringify(patch.requestedLaunch) : null,
      patch.effectiveLaunch ? JSON.stringify(patch.effectiveLaunch) : null,
      patch.briefPath ?? null,
      patch.resultPath ?? null,
      patch.resultJson !== undefined ? JSON.stringify(patch.resultJson) : null,
      patch.artifactsJson ? JSON.stringify(patch.artifactsJson) : null,
      patch.failureReason ?? null,
      patch.workspaceWorktreeId ?? null,
      patch.transcriptRef ? JSON.stringify(patch.transcriptRef) : null,
      id
    )
  const row = selectAttemptRow(this.db, id)
  return row ? toAttemptView(row) : undefined
}

export function transitionWorkflowAttempt(
  this: OrchestrationDb,
  id: string,
  toState: WorkflowAttemptState
): NodeAttemptView | undefined {
  const row = selectAttemptRow(this.db, id)
  if (!row) {
    return undefined
  }
  if (!canTransition('attempt', row.state, toState)) {
    throw new OrchestrationError(
      'workflow_attempt_transition_invalid',
      `Node attempt ${id} cannot transition from ${row.state} to ${toState}.`,
      { attemptId: id, from: row.state, to: toState }
    )
  }
  const now = Date.now()
  const enteringRunning = toState === 'running' && row.started_at === null
  const enteringTerminal = WORKFLOW_ATTEMPT_TERMINAL_STATES.has(toState)
  this.db
    .prepare(
      `UPDATE workflow_node_attempts SET
         state = ?,
         started_at = CASE WHEN ? THEN ? ELSE started_at END,
         finished_at = CASE WHEN ? THEN ? ELSE finished_at END
       WHERE id = ?`
    )
    .run(toState, enteringRunning ? 1 : 0, now, enteringTerminal ? 1 : 0, now, id)
  const updated = selectAttemptRow(this.db, id)
  return updated ? toAttemptView(updated) : undefined
}

export function listWorkflowAttempts(this: OrchestrationDb, runId: string): NodeAttemptView[] {
  const rows = selectWorkflowRows<WorkflowNodeAttemptRow>(
    this.db,
    'SELECT * FROM workflow_node_attempts WHERE run_id = ? ORDER BY id',
    runId
  )
  return rows.map(toAttemptView)
}

export function findWorkflowAttemptByTask(
  this: OrchestrationDb,
  taskId: string
): NodeAttemptView | undefined {
  const row = selectWorkflowRow<WorkflowNodeAttemptRow>(
    this.db,
    'SELECT * FROM workflow_node_attempts WHERE task_id = ?',
    taskId
  )
  return row ? toAttemptView(row) : undefined
}

/**
 * A rerun's retained upstream attempts (FR-030): same state, results, artifacts and timing, in one
 * transaction. The Task is not carried over; it belongs to the source run's orchestration Run.
 */
export function copyWorkflowAttempts(
  this: OrchestrationDb,
  sourceAttemptIds: readonly string[],
  targetRunId: string
): NodeAttemptView[] {
  const copyIds: string[] = []
  const insert = this.db.prepare(
    `INSERT INTO workflow_node_attempts (
       id, run_id, node_id, node_type, iteration, attempt_index, task_id, dispatch_id, state,
       requested_launch, effective_launch, brief_path, result_path, result_json, artifacts_json,
       failure_reason, workspace_worktree_id, transcript_ref, started_at, finished_at
     )
     SELECT ?, ?, node_id, node_type, iteration, attempt_index, NULL, dispatch_id, state,
       requested_launch, effective_launch, brief_path, result_path, result_json, artifacts_json,
       failure_reason, workspace_worktree_id, transcript_ref, started_at, finished_at
     FROM workflow_node_attempts WHERE id = ?`
  )
  this.db.exec('BEGIN IMMEDIATE')
  try {
    for (const sourceId of sourceAttemptIds) {
      const id = generateId('wfa')
      if (insert.run(id, targetRunId, sourceId).changes !== 1) {
        throw new Error(`Node attempt ${sourceId} was not found to copy.`)
      }
      copyIds.push(id)
    }
    this.db.exec('COMMIT')
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
  return copyIds.flatMap((id) => {
    const row = selectAttemptRow(this.db, id)
    return row ? [toAttemptView(row)] : []
  })
}

export type WorkflowAttemptStoreMethods = {
  createWorkflowAttempt: typeof createWorkflowAttempt
  updateWorkflowAttempt: typeof updateWorkflowAttempt
  transitionWorkflowAttempt: typeof transitionWorkflowAttempt
  listWorkflowAttempts: typeof listWorkflowAttempts
  findWorkflowAttemptByTask: typeof findWorkflowAttemptByTask
  copyWorkflowAttempts: typeof copyWorkflowAttempts
}

export function attachWorkflowAttemptStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createWorkflowAttempt,
    updateWorkflowAttempt,
    transitionWorkflowAttempt,
    listWorkflowAttempts,
    findWorkflowAttemptByTask,
    copyWorkflowAttempts
  })
}
