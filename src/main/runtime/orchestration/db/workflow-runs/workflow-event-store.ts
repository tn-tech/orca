import type { RunEventView } from '../../../../../shared/workflows/workflow-run-types'
import type { JsonValue } from '../../../../../shared/workflows/workflow-condition-schema'
import { OrchestrationError } from '../../orchestration-error'
import type { OrchestrationDb } from '../orchestration-db'
import { selectWorkflowRow, selectWorkflowRows } from './workflow-row-projection'

// ── Workflow Run Events ──

const WORKFLOW_EVENT_PAGE_LIMIT = 200
/** workflow.run.show's "events tail" (contracts/rpc-methods.md) — a quick-glance count, not a page;
 *  `workflow.run.events` is the paged view for full history. */
const RUN_SHOW_EVENT_TAIL_LIMIT = 50

type WorkflowRunEventRow = {
  id: number
  run_id: string
  attempt_id: string | null
  kind: string
  payload_json: string
  created_at: number
}

function toEventView(row: WorkflowRunEventRow): RunEventView {
  return {
    id: String(row.id),
    runId: row.run_id,
    attemptId: row.attempt_id ?? undefined,
    kind: row.kind,
    payloadJson: JSON.parse(row.payload_json),
    createdAt: new Date(row.created_at).toISOString()
  }
}

export function appendWorkflowEvent(
  this: OrchestrationDb,
  params: {
    runId: string
    attemptId?: string
    kind: string
    payloadJson?: JsonValue
  }
): RunEventView {
  if (!this.getWorkflowRun(params.runId)) {
    throw new OrchestrationError(
      'workflow_run_not_found',
      `Workflow run ${params.runId} was not found while appending an event.`,
      { runId: params.runId }
    )
  }
  const result = this.db
    .prepare(
      `INSERT INTO workflow_run_events (run_id, attempt_id, kind, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      params.runId,
      params.attemptId ?? null,
      params.kind,
      JSON.stringify(params.payloadJson ?? {}),
      Date.now()
    )
  const id = Number(result.lastInsertRowid)
  const row = selectWorkflowRow<WorkflowRunEventRow>(
    this.db,
    'SELECT * FROM workflow_run_events WHERE id = ?',
    id
  )
  if (!row) {
    throw new Error(`Workflow run event ${id} was not found immediately after insert.`)
  }
  return toEventView(row)
}

export function listWorkflowEvents(
  this: OrchestrationDb,
  runId: string,
  afterSeq = 0,
  limit = WORKFLOW_EVENT_PAGE_LIMIT
): RunEventView[] {
  const boundedLimit = Math.min(Math.max(1, limit), WORKFLOW_EVENT_PAGE_LIMIT)
  const rows = selectWorkflowRows<WorkflowRunEventRow>(
    this.db,
    'SELECT * FROM workflow_run_events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT ?',
    runId,
    afterSeq,
    boundedLimit
  )
  return rows.map(toEventView)
}

/** The most recent `limit` events, oldest first — for `workflow.run.show`, unlike
 *  `listWorkflowEvents`'s from-the-start paging. */
export function listWorkflowEventsTail(
  this: OrchestrationDb,
  runId: string,
  limit = RUN_SHOW_EVENT_TAIL_LIMIT
): RunEventView[] {
  const rows = selectWorkflowRows<WorkflowRunEventRow>(
    this.db,
    'SELECT * FROM workflow_run_events WHERE run_id = ? ORDER BY id DESC LIMIT ?',
    runId,
    limit
  )
  return rows.map(toEventView).toReversed()
}

export type WorkflowEventStoreMethods = {
  appendWorkflowEvent: typeof appendWorkflowEvent
  listWorkflowEvents: typeof listWorkflowEvents
  listWorkflowEventsTail: typeof listWorkflowEventsTail
}

export function attachWorkflowEventStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    appendWorkflowEvent,
    listWorkflowEvents,
    listWorkflowEventsTail
  })
}
