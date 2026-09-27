import type {
  RunQuestionView,
  WorkflowQuestionKind,
  WorkflowQuestionState
} from '../../../../../shared/workflows/workflow-run-types'
import type { JsonValue } from '../../../../../shared/workflows/workflow-condition-schema'
import { OrchestrationError } from '../../orchestration-error'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import { selectWorkflowRow, selectWorkflowRows } from './workflow-row-projection'

// ── Workflow Run Questions ──

type WorkflowRunQuestionRow = {
  id: string
  run_id: string
  attempt_id: string
  kind: WorkflowQuestionKind
  gate_id: string | null
  question_message_id: string | null
  prompt: string
  options_json: string
  state: WorkflowQuestionState
  answer: string | null
  answered_by: string | null
  answered_at: number | null
  timeout_at: number | null
  escalation_at: number | null
}

function selectQuestionRow(
  db: OrchestrationDb['db'],
  id: string
): WorkflowRunQuestionRow | undefined {
  return selectWorkflowRow<WorkflowRunQuestionRow>(
    db,
    'SELECT * FROM workflow_run_questions WHERE id = ?',
    id
  )
}

function toQuestionView(row: WorkflowRunQuestionRow): RunQuestionView {
  return {
    id: row.id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    kind: row.kind,
    gateId: row.gate_id ?? undefined,
    questionMessageId: row.question_message_id ?? undefined,
    prompt: row.prompt,
    optionsJson: JSON.parse(row.options_json),
    state: row.state,
    answer: row.answer ?? undefined,
    answeredBy: row.answered_by ?? undefined,
    answeredAt: row.answered_at ? new Date(row.answered_at).toISOString() : undefined,
    timeoutAt: row.timeout_at ? new Date(row.timeout_at).toISOString() : undefined,
    escalationAt: row.escalation_at ? new Date(row.escalation_at).toISOString() : undefined
  }
}

export function createWorkflowQuestion(
  this: OrchestrationDb,
  params: {
    runId: string
    attemptId: string
    kind: WorkflowQuestionKind
    gateId?: string
    questionMessageId?: string
    prompt: string
    options?: JsonValue
    timeoutAt?: number
    escalationAt?: number
  }
): RunQuestionView {
  if (!this.getWorkflowRun(params.runId)) {
    throw new OrchestrationError(
      'workflow_run_not_found',
      `Workflow run ${params.runId} was not found while creating a question.`,
      { runId: params.runId }
    )
  }
  const id = generateId('wfq')
  this.db
    .prepare(
      `INSERT INTO workflow_run_questions (
         id, run_id, attempt_id, kind, gate_id, question_message_id,
         prompt, options_json, timeout_at, escalation_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.runId,
      params.attemptId,
      params.kind,
      params.gateId ?? null,
      params.questionMessageId ?? null,
      params.prompt,
      JSON.stringify(params.options ?? []),
      params.timeoutAt ?? null,
      params.escalationAt ?? null
    )
  const row = selectQuestionRow(this.db, id)
  if (!row) {
    throw new Error(`Workflow question ${id} was not found immediately after insert.`)
  }
  return toQuestionView(row)
}

export function listPendingWorkflowQuestions(
  this: OrchestrationDb,
  runId?: string
): RunQuestionView[] {
  const rows = runId
    ? selectWorkflowRows<WorkflowRunQuestionRow>(
        this.db,
        "SELECT * FROM workflow_run_questions WHERE run_id = ? AND state = 'pending' ORDER BY id",
        runId
      )
    : selectWorkflowRows<WorkflowRunQuestionRow>(
        this.db,
        "SELECT * FROM workflow_run_questions WHERE state = 'pending' ORDER BY id"
      )
  return rows.map(toQuestionView)
}

/**
 * Questions still waiting for a person: `pending`, or `escalated` (timed out, still answerable
 * until the escalation grace ends).
 */
export function listOpenWorkflowQuestions(this: OrchestrationDb, runId: string): RunQuestionView[] {
  const rows = selectWorkflowRows<WorkflowRunQuestionRow>(
    this.db,
    `SELECT * FROM workflow_run_questions
     WHERE run_id = ? AND state IN ('pending', 'escalated') ORDER BY rowid`,
    runId
  )
  return rows.map(toQuestionView)
}

/** Every question for a run, any state — the run view (workflow.run.show) unlike the pending-only list above. */
export function listWorkflowQuestions(this: OrchestrationDb, runId: string): RunQuestionView[] {
  const rows = selectWorkflowRows<WorkflowRunQuestionRow>(
    this.db,
    // Why rowid, not id: id is random-generated (generateId), not chronological.
    'SELECT * FROM workflow_run_questions WHERE run_id = ? ORDER BY rowid',
    runId
  )
  return rows.map(toQuestionView)
}

export function answerWorkflowQuestion(
  this: OrchestrationDb,
  id: string,
  answer: string,
  answeredBy: string
): RunQuestionView | undefined {
  this.db
    .prepare(
      // Why: the state guard keeps a late answer from overwriting one the run already recorded;
      // an escalated question stays answerable until it expires.
      `UPDATE workflow_run_questions
       SET state = 'answered', answer = ?, answered_by = ?, answered_at = ?
       WHERE id = ? AND state IN ('pending', 'escalated')`
    )
    .run(answer, answeredBy, Date.now(), id)
  const row = selectQuestionRow(this.db, id)
  return row ? toQuestionView(row) : undefined
}

export function escalateWorkflowQuestion(
  this: OrchestrationDb,
  id: string
): RunQuestionView | undefined {
  this.db
    .prepare(
      "UPDATE workflow_run_questions SET state = 'escalated' WHERE id = ? AND state = 'pending'"
    )
    .run(id)
  const row = selectQuestionRow(this.db, id)
  return row ? toQuestionView(row) : undefined
}

export function expireWorkflowQuestion(
  this: OrchestrationDb,
  id: string
): RunQuestionView | undefined {
  this.db
    .prepare(
      "UPDATE workflow_run_questions SET state = 'expired' WHERE id = ? AND state IN ('pending', 'escalated')"
    )
    .run(id)
  const row = selectQuestionRow(this.db, id)
  return row ? toQuestionView(row) : undefined
}

export function listExpiredWorkflowQuestions(
  this: OrchestrationDb,
  now: number
): RunQuestionView[] {
  const rows = selectWorkflowRows<WorkflowRunQuestionRow>(
    this.db,
    `SELECT * FROM workflow_run_questions
     WHERE state = 'pending' AND timeout_at IS NOT NULL AND timeout_at <= ?
     ORDER BY timeout_at ASC`,
    now
  )
  return rows.map(toQuestionView)
}

export type WorkflowQuestionStoreMethods = {
  createWorkflowQuestion: typeof createWorkflowQuestion
  listPendingWorkflowQuestions: typeof listPendingWorkflowQuestions
  listOpenWorkflowQuestions: typeof listOpenWorkflowQuestions
  listWorkflowQuestions: typeof listWorkflowQuestions
  answerWorkflowQuestion: typeof answerWorkflowQuestion
  escalateWorkflowQuestion: typeof escalateWorkflowQuestion
  expireWorkflowQuestion: typeof expireWorkflowQuestion
  listExpiredWorkflowQuestions: typeof listExpiredWorkflowQuestions
}

export function attachWorkflowQuestionStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createWorkflowQuestion,
    listPendingWorkflowQuestions,
    listOpenWorkflowQuestions,
    listWorkflowQuestions,
    answerWorkflowQuestion,
    escalateWorkflowQuestion,
    expireWorkflowQuestion,
    listExpiredWorkflowQuestions
  })
}
