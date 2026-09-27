import {
  RoleProposalChangeSchema,
  type RoleProposalInput
} from '../../../../../shared/workflows/workflow-role-proposal-schema'
import type {
  RoleProposalState,
  RoleProposalView
} from '../../../../../shared/workflows/workflow-run-types'
import { OrchestrationError } from '../../orchestration-error'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import { selectWorkflowRow, selectWorkflowRows } from './workflow-row-projection'

// ── Workflow Role Proposals (data-model.md §3 `workflow_role_proposals`, US7) ──

type WorkflowRoleProposalRow = {
  id: string
  run_id: string
  attempt_id: string
  role_id: string
  diff_json: string
  evidence: string | null
  state: RoleProposalState
}

function parseChange(diffJson: string): RoleProposalView['change'] {
  try {
    const parsed = RoleProposalChangeSchema.safeParse(JSON.parse(diffJson))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

function toProposalView(row: WorkflowRoleProposalRow): RoleProposalView {
  return {
    id: row.id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    roleId: row.role_id,
    change: parseChange(row.diff_json),
    evidence: row.evidence ?? '',
    state: row.state
  }
}

export function listWorkflowRoleProposals(
  this: OrchestrationDb,
  runId: string
): RoleProposalView[] {
  const rows = selectWorkflowRows<WorkflowRoleProposalRow>(
    this.db,
    // Why rowid, not id: id is random-generated (generateId), not chronological.
    'SELECT * FROM workflow_role_proposals WHERE run_id = ? ORDER BY rowid',
    runId
  )
  return rows.map(toProposalView)
}

export function getWorkflowRoleProposal(
  this: OrchestrationDb,
  id: string
): RoleProposalView | undefined {
  const row = selectWorkflowRow<WorkflowRoleProposalRow>(
    this.db,
    'SELECT * FROM workflow_role_proposals WHERE id = ?',
    id
  )
  return row ? toProposalView(row) : undefined
}

/**
 * Stores one Reflection attempt's proposals. A replayed `worker_done` for the same attempt finds
 * its proposals already stored and returns them instead of adding duplicates.
 */
export function recordWorkflowRoleProposals(
  this: OrchestrationDb,
  runId: string,
  attemptId: string,
  proposals: readonly RoleProposalInput[]
): RoleProposalView[] {
  if (!this.getWorkflowRun(runId)) {
    throw new OrchestrationError(
      'workflow_run_not_found',
      `Workflow run ${runId} was not found while recording role proposals.`,
      { runId }
    )
  }
  const stored = (): RoleProposalView[] =>
    this.listWorkflowRoleProposals(runId).filter((proposal) => proposal.attemptId === attemptId)
  this.db.exec('BEGIN IMMEDIATE')
  try {
    if (stored().length === 0) {
      const insert = this.db.prepare(
        `INSERT INTO workflow_role_proposals (id, run_id, attempt_id, role_id, diff_json, evidence)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      for (const proposal of proposals) {
        insert.run(
          generateId('wfp'),
          runId,
          attemptId,
          proposal.roleId,
          JSON.stringify(proposal.change),
          proposal.evidence
        )
      }
    }
    this.db.exec('COMMIT')
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
  return stored()
}

/** Moves a proposal to `toState` only from one of `fromStates`; `undefined` when it was not there. */
export function transitionWorkflowRoleProposal(
  this: OrchestrationDb,
  id: string,
  toState: RoleProposalState,
  fromStates: readonly RoleProposalState[]
): RoleProposalView | undefined {
  const placeholders = fromStates.map(() => '?').join(', ')
  const result = this.db
    .prepare(
      `UPDATE workflow_role_proposals SET state = ? WHERE id = ? AND state IN (${placeholders})`
    )
    .run(toState, id, ...fromStates)
  return result.changes > 0 ? this.getWorkflowRoleProposal(id) : undefined
}

export type WorkflowProposalStoreMethods = {
  listWorkflowRoleProposals: typeof listWorkflowRoleProposals
  getWorkflowRoleProposal: typeof getWorkflowRoleProposal
  recordWorkflowRoleProposals: typeof recordWorkflowRoleProposals
  transitionWorkflowRoleProposal: typeof transitionWorkflowRoleProposal
}

export function attachWorkflowProposalStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    listWorkflowRoleProposals,
    getWorkflowRoleProposal,
    recordWorkflowRoleProposals,
    transitionWorkflowRoleProposal
  })
}
