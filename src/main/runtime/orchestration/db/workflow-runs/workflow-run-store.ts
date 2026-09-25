import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { canTransition } from '../../../../../shared/workflows/workflow-node-states'
import type {
  RunSnapshot,
  RunSummary,
  WorkflowRunSource
} from '../../../../../shared/workflows/workflow-run-types'
import type { WorkflowRunState } from '../../../../../shared/workflows/workflow-node-states'
import { OrchestrationError } from '../../orchestration-error'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import { selectWorkflowRow, selectWorkflowRows } from './workflow-row-projection'

// ── Workflow Runs ──

const DEFAULT_WORKFLOW_CONCURRENCY_LIMIT = 4
const WORKFLOW_RUN_PAGE_LIMIT = 50
const WORKFLOW_RUN_TERMINAL_STATES = new Set<WorkflowRunState>(['completed', 'failed', 'cancelled'])

type WorkflowRunRow = {
  id: string
  workflow_name: string
  workflow_source: WorkflowRunSource
  workflow_snapshot: string
  workflow_version: string
  objective: string
  repo_id: string
  worktree_id: string
  orchestration_run_id: string | null
  state: WorkflowRunState
  concurrency_limit: number | null
  started_by_client: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
  rerun_of_run_id: string | null
  rerun_from_node_id: string | null
}

function selectRunRow(db: OrchestrationDb['db'], id: string): WorkflowRunRow | undefined {
  return selectWorkflowRow<WorkflowRunRow>(db, 'SELECT * FROM workflow_runs WHERE id = ?', id)
}

function toRunSnapshot(row: WorkflowRunRow): RunSnapshot {
  return {
    id: row.id,
    workflowName: row.workflow_name,
    workflowSource: row.workflow_source,
    workflowSnapshot: JSON.parse(row.workflow_snapshot),
    workflowVersion: row.workflow_version,
    objective: row.objective,
    repoId: row.repo_id,
    worktreeId: row.worktree_id,
    orchestrationRunId: row.orchestration_run_id ?? undefined,
    state: row.state,
    concurrencyLimit: row.concurrency_limit ?? DEFAULT_WORKFLOW_CONCURRENCY_LIMIT,
    startedByClient: row.started_by_client ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : undefined,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : undefined,
    rerunOfRunId: row.rerun_of_run_id ?? undefined,
    rerunFromNodeId: row.rerun_from_node_id ?? undefined
  }
}

function toRunSummary(row: WorkflowRunRow): RunSummary {
  const { workflowSnapshot: _snapshot, ...summary } = toRunSnapshot(row)
  return summary
}

type WorkflowRunListCursor = { createdAt: number; id: string }

function isWorkflowRunListCursor(value: unknown): value is WorkflowRunListCursor {
  if (!value || typeof value !== 'object') {
    return false
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only used to probe properties before the typeof checks below decide the type guard's result.
  const candidate = value as Record<string, unknown>
  return typeof candidate.createdAt === 'number' && typeof candidate.id === 'string'
}

function encodeWorkflowRunListCursor(row: WorkflowRunRow): string {
  const cursor: WorkflowRunListCursor = { createdAt: row.created_at, id: row.id }
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeWorkflowRunListCursor(value: string): WorkflowRunListCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new OrchestrationError('cursor_invalid', 'The Workflow run list cursor is invalid.')
  }
  if (!isWorkflowRunListCursor(parsed)) {
    throw new OrchestrationError('cursor_invalid', 'The Workflow run list cursor is invalid.')
  }
  return parsed
}

export function createWorkflowRun(
  this: OrchestrationDb,
  params: {
    workflowName: string
    workflowSource: WorkflowRunSource
    workflowSnapshot: Workflow
    workflowVersion: string
    objective: string
    repoId: string
    worktreeId: string
    orchestrationRunId?: string
    concurrencyLimit?: number
    startedByClient?: string
    rerunOfRunId?: string
    rerunFromNodeId?: string
  }
): RunSnapshot {
  const id = generateId('wfr')
  this.db
    .prepare(
      `INSERT INTO workflow_runs (
         id, workflow_name, workflow_source, workflow_snapshot, workflow_version,
         objective, repo_id, worktree_id, orchestration_run_id, state,
         concurrency_limit, started_by_client, created_at, rerun_of_run_id, rerun_from_node_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.workflowName,
      params.workflowSource,
      JSON.stringify(params.workflowSnapshot),
      params.workflowVersion,
      params.objective,
      params.repoId,
      params.worktreeId,
      params.orchestrationRunId ?? null,
      params.concurrencyLimit ?? null,
      params.startedByClient ?? null,
      Date.now(),
      params.rerunOfRunId ?? null,
      params.rerunFromNodeId ?? null
    )
  const row = selectRunRow(this.db, id)
  if (!row) {
    throw new Error(`Workflow run ${id} was not found immediately after insert.`)
  }
  return toRunSnapshot(row)
}

export function getWorkflowRun(this: OrchestrationDb, id: string): RunSnapshot | undefined {
  const row = selectRunRow(this.db, id)
  return row ? toRunSnapshot(row) : undefined
}

export function transitionWorkflowRun(
  this: OrchestrationDb,
  id: string,
  toState: WorkflowRunState
): RunSnapshot | undefined {
  const row = selectRunRow(this.db, id)
  if (!row) {
    return undefined
  }
  if (!canTransition('run', row.state, toState)) {
    throw new OrchestrationError(
      'workflow_run_transition_invalid',
      `Workflow run ${id} cannot transition from ${row.state} to ${toState}.`,
      { runId: id, from: row.state, to: toState }
    )
  }
  const now = Date.now()
  const enteringRunning = toState === 'running' && row.started_at === null
  const enteringTerminal = WORKFLOW_RUN_TERMINAL_STATES.has(toState)
  this.db
    .prepare(
      `UPDATE workflow_runs SET
         state = ?,
         started_at = CASE WHEN ? THEN ? ELSE started_at END,
         finished_at = CASE WHEN ? THEN ? ELSE finished_at END
       WHERE id = ?`
    )
    .run(toState, enteringRunning ? 1 : 0, now, enteringTerminal ? 1 : 0, now, id)
  return this.getWorkflowRun(id)
}

export function listWorkflowRuns(
  this: OrchestrationDb,
  filter: {
    repoId?: string
    name?: string
    state?: WorkflowRunState
    cursor?: string
    limit?: number
  } = {}
): { runs: RunSummary[]; nextCursor: string | null } {
  const limit = Math.min(
    Math.max(1, filter.limit ?? WORKFLOW_RUN_PAGE_LIMIT),
    WORKFLOW_RUN_PAGE_LIMIT
  )
  const cursor = filter.cursor ? decodeWorkflowRunListCursor(filter.cursor) : undefined

  const clauses: string[] = []
  const params: (string | number)[] = []
  if (filter.repoId) {
    clauses.push('repo_id = ?')
    params.push(filter.repoId)
  }
  if (filter.name) {
    clauses.push('workflow_name = ?')
    params.push(filter.name)
  }
  if (filter.state) {
    clauses.push('state = ?')
    params.push(filter.state)
  }
  if (cursor) {
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))')
    params.push(cursor.createdAt, cursor.createdAt, cursor.id)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = selectWorkflowRows<WorkflowRunRow>(
    this.db,
    `SELECT * FROM workflow_runs ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ...params,
    limit + 1
  )
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const lastRow = pageRows.at(-1)
  return {
    runs: pageRows.map(toRunSummary),
    nextCursor: hasMore && lastRow ? encodeWorkflowRunListCursor(lastRow) : null
  }
}

export function listActiveWorkflowRuns(this: OrchestrationDb): RunSummary[] {
  const rows = selectWorkflowRows<WorkflowRunRow>(
    this.db,
    "SELECT * FROM workflow_runs WHERE state NOT IN ('completed', 'failed', 'cancelled') ORDER BY created_at"
  )
  return rows.map(toRunSummary)
}

export type WorkflowRunStoreMethods = {
  createWorkflowRun: typeof createWorkflowRun
  getWorkflowRun: typeof getWorkflowRun
  transitionWorkflowRun: typeof transitionWorkflowRun
  listWorkflowRuns: typeof listWorkflowRuns
  listActiveWorkflowRuns: typeof listActiveWorkflowRuns
}

export function attachWorkflowRunStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createWorkflowRun,
    getWorkflowRun,
    transitionWorkflowRun,
    listWorkflowRuns,
    listActiveWorkflowRuns
  })
}
