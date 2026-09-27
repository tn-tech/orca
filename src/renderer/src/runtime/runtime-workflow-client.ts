import type {
  Role,
  Workflow,
  WorkflowProblem
} from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunSource } from '../../../shared/workflows/workflow-run-types'
import {
  callWorkflowRpc,
  WORKFLOW_DRAFT_TIMEOUT_MS,
  WORKFLOW_RUN_ACTION_TIMEOUT_MS,
  type RuntimeWorkflowSettings
} from './runtime-workflow-rpc'

export type { RuntimeWorkflowSettings } from './runtime-workflow-rpc'

// ---- Definitions ----

export type WorkflowSummary = {
  name: string
  source: WorkflowRunSource
  path: string
  description?: string
  valid: boolean
}

export type WorkflowReadResult = {
  definition: Workflow
  raw: string
  revision: string
  problems: WorkflowProblem[]
}

export type WorkflowWriteResult = { revision: string }
export type WorkflowValidateResult = { problems: WorkflowProblem[] }
export type WorkflowDuplicateResult = { name: string; revision: string }
export type WorkflowImportRoleResult = {
  role: Role
  /** Present when `workflow` was given and the write succeeded — the new content-hash revision. */
  revision?: string
  /** Present when a locally modified role was kept instead: the upstream commit not applied. */
  availableVersion?: string
}
export type WorkflowDraftResult = {
  /** Absent when the planner's output didn't parse as a workflow definition (e.g. it timed out). */
  definition?: Workflow
  problems: WorkflowProblem[]
  /** Always true: the definition exists only in this result until the user saves it (US6 AS2). */
  draft: true
  /** The planner's own run, so a client can show its transcript. */
  runId: string
}

export function workflowList(
  settings: RuntimeWorkflowSettings,
  repo: string
): Promise<{ workflows: WorkflowSummary[] }> {
  return callWorkflowRpc(settings, 'workflow.list', { repo })
}

export function workflowRead(
  settings: RuntimeWorkflowSettings,
  params: { repo: string; name: string; source?: WorkflowRunSource }
): Promise<WorkflowReadResult> {
  return callWorkflowRpc(settings, 'workflow.read', params)
}

export function workflowWrite(
  settings: RuntimeWorkflowSettings,
  params: {
    repo: string
    name: string
    source?: WorkflowRunSource
    definition?: Workflow
    expectedRevision?: string
  }
): Promise<WorkflowWriteResult> {
  return callWorkflowRpc(settings, 'workflow.write', params)
}

export function workflowValidate(
  settings: RuntimeWorkflowSettings,
  params: { repo: string; definition?: Workflow }
): Promise<WorkflowValidateResult> {
  return callWorkflowRpc(settings, 'workflow.validate', params)
}

export function workflowDelete(
  settings: RuntimeWorkflowSettings,
  params: { repo: string; name: string; source?: WorkflowRunSource }
): Promise<Record<string, never>> {
  return callWorkflowRpc(settings, 'workflow.delete', params)
}

export function workflowDuplicate(
  settings: RuntimeWorkflowSettings,
  params: { repo: string; name: string; source?: WorkflowRunSource; newName?: string }
): Promise<WorkflowDuplicateResult> {
  return callWorkflowRpc(settings, 'workflow.duplicate', params)
}

export function workflowImportRole(
  settings: RuntimeWorkflowSettings,
  params: {
    repo: string
    source: string
    roleName: string
    /** A branch or tag name in the role repository; omitted means its default branch. */
    version?: string
    /** Take upstream even when the local copy of the role was modified since its last import. */
    overwriteLocal?: boolean
    /** Named to copy the fetched role straight into that workflow file (a re-import); omitted to
     *  only fetch and return the role for the caller to insert into its own draft. */
    workflow?: string
    workflowSource?: WorkflowRunSource
    expectedRevision?: string
  }
): Promise<WorkflowImportRoleResult> {
  return callWorkflowRpc(settings, 'workflow.importRole', params)
}

export function workflowDraft(
  settings: RuntimeWorkflowSettings,
  params: { repo: string; objective?: string }
): Promise<WorkflowDraftResult> {
  return callWorkflowRpc(settings, 'workflow.draft', params, WORKFLOW_DRAFT_TIMEOUT_MS)
}

// ---- Runs ----
// Split into runtime-workflow-run-client.ts to keep this file ≤300 lines; re-exported so existing
// `@/runtime/runtime-workflow-client` imports (workflowRunStart, WorkflowRunSnapshotView, etc.)
// keep working unchanged.
export * from './runtime-workflow-run-client'

// ---- Trust & proposals ----

export type WorkflowTrustDecision = {
  source: string
  /** `local`, `ssh:<connectionId>`, or `wsl:<distro>` (data-model.md §3 `workflow_source_trust`). */
  host: string
  decision: 'trusted' | 'refused'
  decidedBy: string
  decidedAt: string
}
export type WorkflowTrustListResult = { decisions: WorkflowTrustDecision[] }
export type WorkflowProposalAcceptResult = { revision: string }
export type WorkflowProposalExportResult = { exportPath: string }

export function workflowTrustList(
  settings: RuntimeWorkflowSettings
): Promise<WorkflowTrustListResult> {
  return callWorkflowRpc(settings, 'workflow.trust.list')
}

export function workflowTrustDecide(
  settings: RuntimeWorkflowSettings,
  params: { source: string; decision?: 'trusted' | 'refused'; host?: string }
): Promise<Record<string, never>> {
  return callWorkflowRpc(settings, 'workflow.trust.decide', params)
}

/** Forgets a source's decision on `host` (FR-018a revoke: the next run asks again), as opposed
 *  to `workflowTrustDecide(..., 'refused')` (which fails the node instead of asking). A host that
 *  predates this method answers `method_not_found`. */
export function workflowTrustRevoke(
  settings: RuntimeWorkflowSettings,
  params: { source: string; host?: string }
): Promise<Record<string, never>> {
  return callWorkflowRpc(settings, 'workflow.trust.revoke', params)
}

export function workflowProposalAccept(
  settings: RuntimeWorkflowSettings,
  params: { runId: string; proposalId: string }
): Promise<WorkflowProposalAcceptResult> {
  return callWorkflowRpc(
    settings,
    'workflow.proposal.accept',
    params,
    WORKFLOW_RUN_ACTION_TIMEOUT_MS
  )
}

export function workflowProposalExport(
  settings: RuntimeWorkflowSettings,
  params: { runId: string; proposalId: string }
): Promise<WorkflowProposalExportResult> {
  return callWorkflowRpc(
    settings,
    'workflow.proposal.export',
    params,
    WORKFLOW_RUN_ACTION_TIMEOUT_MS
  )
}
