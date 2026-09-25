import type { OrchestrationDb } from '../orchestration-db'
import { selectWorkflowRow, selectWorkflowRows } from './workflow-row-projection'

// ── Workflow Source Trust (per-host, data-model.md §3 `workflow_source_trust`) ──

export type WorkflowSourceTrustDecision = 'trusted' | 'refused'

export type SourceTrustView = {
  source: string
  decision: WorkflowSourceTrustDecision
  decidedBy: string
  decidedAt: string
}

type WorkflowSourceTrustRow = {
  source: string
  decision: WorkflowSourceTrustDecision
  decided_by: string
  decided_at: number
}

function toSourceTrustView(row: WorkflowSourceTrustRow): SourceTrustView {
  return {
    source: row.source,
    decision: row.decision,
    decidedBy: row.decided_by,
    decidedAt: new Date(row.decided_at).toISOString()
  }
}

export function getSourceTrust(this: OrchestrationDb, source: string): SourceTrustView | undefined {
  const row = selectWorkflowRow<WorkflowSourceTrustRow>(
    this.db,
    'SELECT * FROM workflow_source_trust WHERE source = ?',
    source
  )
  return row ? toSourceTrustView(row) : undefined
}

export function setSourceTrust(
  this: OrchestrationDb,
  source: string,
  decision: WorkflowSourceTrustDecision,
  decidedBy: string
): SourceTrustView {
  this.db
    .prepare(
      `INSERT INTO workflow_source_trust (source, decision, decided_by, decided_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET
         decision = excluded.decision, decided_by = excluded.decided_by, decided_at = excluded.decided_at`
    )
    .run(source, decision, decidedBy, Date.now())
  const row = selectWorkflowRow<WorkflowSourceTrustRow>(
    this.db,
    'SELECT * FROM workflow_source_trust WHERE source = ?',
    source
  )
  if (!row) {
    throw new Error(`Source trust decision for ${source} was not found immediately after upsert.`)
  }
  return toSourceTrustView(row)
}

export function listSourceTrust(this: OrchestrationDb): SourceTrustView[] {
  const rows = selectWorkflowRows<WorkflowSourceTrustRow>(
    this.db,
    'SELECT * FROM workflow_source_trust ORDER BY source'
  )
  return rows.map(toSourceTrustView)
}

export type WorkflowTrustStoreMethods = {
  getSourceTrust: typeof getSourceTrust
  setSourceTrust: typeof setSourceTrust
  listSourceTrust: typeof listSourceTrust
}

export function attachWorkflowTrustStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    getSourceTrust,
    setSourceTrust,
    listSourceTrust
  })
}
