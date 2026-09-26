import type {
  RunMessageView,
  WorkflowMessageMode,
  WorkflowMessageState
} from '../../../../../shared/workflows/workflow-run-types'
import { OrchestrationError } from '../../orchestration-error'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import { selectWorkflowRow, selectWorkflowRows } from './workflow-row-projection'

// ── Workflow Run Messages ──

type WorkflowRunMessageRow = {
  id: string
  run_id: string
  attempt_id: string
  sender: string
  text: string
  mode: WorkflowMessageMode
  state: WorkflowMessageState
  created_at: number
  delivered_at: number | null
}

function toMessageView(row: WorkflowRunMessageRow): RunMessageView {
  return {
    id: row.id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    sender: row.sender,
    text: row.text,
    mode: row.mode,
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : undefined
  }
}

export function createWorkflowMessage(
  this: OrchestrationDb,
  params: {
    runId: string
    attemptId: string
    sender: string
    text: string
    mode: WorkflowMessageMode
  }
): RunMessageView {
  if (!this.getWorkflowRun(params.runId)) {
    throw new OrchestrationError(
      'workflow_run_not_found',
      `Workflow run ${params.runId} was not found while creating a message.`,
      { runId: params.runId }
    )
  }
  const id = generateId('wfm')
  this.db
    .prepare(
      `INSERT INTO workflow_run_messages (
         id, run_id, attempt_id, sender, text, mode, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, params.runId, params.attemptId, params.sender, params.text, params.mode, Date.now())
  const row = selectWorkflowRow<WorkflowRunMessageRow>(
    this.db,
    'SELECT * FROM workflow_run_messages WHERE id = ?',
    id
  )
  if (!row) {
    throw new Error(`Workflow message ${id} was not found immediately after insert.`)
  }
  return toMessageView(row)
}

export function listPendingWorkflowMessages(
  this: OrchestrationDb,
  runId?: string
): RunMessageView[] {
  const rows = runId
    ? selectWorkflowRows<WorkflowRunMessageRow>(
        this.db,
        "SELECT * FROM workflow_run_messages WHERE run_id = ? AND state = 'queued' ORDER BY id",
        runId
      )
    : selectWorkflowRows<WorkflowRunMessageRow>(
        this.db,
        "SELECT * FROM workflow_run_messages WHERE state = 'queued' ORDER BY id"
      )
  return rows.map(toMessageView)
}

/** Every message for a run, any state — the run view (workflow.run.show) unlike the pending-only list above. */
export function listWorkflowMessages(this: OrchestrationDb, runId: string): RunMessageView[] {
  const rows = selectWorkflowRows<WorkflowRunMessageRow>(
    this.db,
    // Why rowid, not id: id is random-generated (generateId), not chronological.
    'SELECT * FROM workflow_run_messages WHERE run_id = ? ORDER BY rowid',
    runId
  )
  return rows.map(toMessageView)
}

export function deliverWorkflowMessage(
  this: OrchestrationDb,
  id: string
): RunMessageView | undefined {
  this.db
    .prepare(
      // Why: the state guard keeps a late delivery from overwriting a message already settled failed.
      "UPDATE workflow_run_messages SET state = 'delivered', delivered_at = ? WHERE id = ? AND state = 'queued'"
    )
    .run(Date.now(), id)
  const row = selectWorkflowRow<WorkflowRunMessageRow>(
    this.db,
    'SELECT * FROM workflow_run_messages WHERE id = ?',
    id
  )
  return row ? toMessageView(row) : undefined
}

export function failWorkflowMessage(this: OrchestrationDb, id: string): RunMessageView | undefined {
  this.db
    .prepare("UPDATE workflow_run_messages SET state = 'failed' WHERE id = ? AND state = 'queued'")
    .run(id)
  const row = selectWorkflowRow<WorkflowRunMessageRow>(
    this.db,
    'SELECT * FROM workflow_run_messages WHERE id = ?',
    id
  )
  return row ? toMessageView(row) : undefined
}

export type WorkflowMessageStoreMethods = {
  createWorkflowMessage: typeof createWorkflowMessage
  listPendingWorkflowMessages: typeof listPendingWorkflowMessages
  listWorkflowMessages: typeof listWorkflowMessages
  deliverWorkflowMessage: typeof deliverWorkflowMessage
  failWorkflowMessage: typeof failWorkflowMessage
}

export function attachWorkflowMessageStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createWorkflowMessage,
    listPendingWorkflowMessages,
    listWorkflowMessages,
    deliverWorkflowMessage,
    failWorkflowMessage
  })
}
