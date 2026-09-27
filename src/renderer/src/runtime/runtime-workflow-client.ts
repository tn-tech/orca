import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { OrchestrationWorkerReadResult } from '../../../shared/orchestration-worker-output'
import type {
  Role,
  Workflow,
  WorkflowProblem
} from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowRunState } from '../../../shared/workflows/workflow-node-states'
import type {
  NodeAttemptView,
  RunEventView,
  RunMessageView,
  RunQuestionView,
  RunSnapshot,
  RunSummary,
  WorkflowRunSource
} from '../../../shared/workflows/workflow-run-types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'

export type RuntimeWorkflowSettings =
  | Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>
  | null
  | undefined

const WORKFLOW_RPC_TIMEOUT_MS = 15_000
// Why: run mutations may wait on the workflow engine (start/pause/rerun/etc.); give them room.
const WORKFLOW_RUN_ACTION_TIMEOUT_MS = 30_000

function callWorkflowRpc<TResult>(
  settings: RuntimeWorkflowSettings,
  method: string,
  params?: unknown,
  timeoutMs = WORKFLOW_RPC_TIMEOUT_MS
): Promise<TResult> {
  return callRuntimeRpc<TResult>(getActiveRuntimeTarget(settings), method, params, { timeoutMs })
}

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
export type WorkflowDraftResult = { definition: Workflow; problems: WorkflowProblem[] }

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
  return callWorkflowRpc(settings, 'workflow.draft', params)
}

// ---- Runs ----

/** `workflow.run.show` result: the run row plus its attempts/questions/messages and event tail. */
export type WorkflowRunSnapshotView = RunSnapshot & {
  attempts: NodeAttemptView[]
  questions: RunQuestionView[]
  messages: RunMessageView[]
  events: RunEventView[]
}

export type WorkflowRunStartResult = { runId: string }
export type WorkflowRunListResult = { runs: RunSummary[]; nextCursor?: string }
export type WorkflowRunControlResult = { state: WorkflowRunState }
export type WorkflowRunRerunResult = { runId: string }
export type WorkflowRunAnswerResult = { state: WorkflowRunState }
export type WorkflowRunSendMessageResult = { messageId: string }
export type WorkflowRunEventsResult = { events: RunEventView[]; nextSeq: number }

export function workflowRunStart(
  settings: RuntimeWorkflowSettings,
  params: {
    repo: string
    name: string
    source?: WorkflowRunSource
    objective?: string
    overrides?: { concurrencyLimit?: number }
  }
): Promise<WorkflowRunStartResult> {
  return callWorkflowRpc(settings, 'workflow.run.start', params, WORKFLOW_RUN_ACTION_TIMEOUT_MS)
}

export function workflowRunList(
  settings: RuntimeWorkflowSettings,
  params?: {
    repo?: string
    name?: string
    state?: WorkflowRunState
    cursor?: string
    limit?: number
  }
): Promise<WorkflowRunListResult> {
  return callWorkflowRpc(settings, 'workflow.run.list', params)
}

export function workflowRunShow(
  settings: RuntimeWorkflowSettings,
  runId: string
): Promise<WorkflowRunSnapshotView> {
  return callWorkflowRpc(settings, 'workflow.run.show', { runId })
}

export function workflowRunPause(
  settings: RuntimeWorkflowSettings,
  runId: string
): Promise<WorkflowRunControlResult> {
  return callWorkflowRpc(settings, 'workflow.run.pause', { runId }, WORKFLOW_RUN_ACTION_TIMEOUT_MS)
}

export function workflowRunResume(
  settings: RuntimeWorkflowSettings,
  runId: string
): Promise<WorkflowRunControlResult> {
  return callWorkflowRpc(settings, 'workflow.run.resume', { runId }, WORKFLOW_RUN_ACTION_TIMEOUT_MS)
}

export function workflowRunCancel(
  settings: RuntimeWorkflowSettings,
  runId: string
): Promise<WorkflowRunControlResult> {
  return callWorkflowRpc(settings, 'workflow.run.cancel', { runId }, WORKFLOW_RUN_ACTION_TIMEOUT_MS)
}

export function workflowRunRerun(
  settings: RuntimeWorkflowSettings,
  params: { runId: string; fromNodeId?: string }
): Promise<WorkflowRunRerunResult> {
  return callWorkflowRpc(settings, 'workflow.run.rerun', params, WORKFLOW_RUN_ACTION_TIMEOUT_MS)
}

export function workflowRunAnswer(
  settings: RuntimeWorkflowSettings,
  params: { runId: string; questionId: string; answer?: string; optionId?: string }
): Promise<WorkflowRunAnswerResult> {
  return callWorkflowRpc(settings, 'workflow.run.answer', params, WORKFLOW_RUN_ACTION_TIMEOUT_MS)
}

export function workflowRunSendMessage(
  settings: RuntimeWorkflowSettings,
  params: { runId: string; attemptId: string; text?: string; mode?: 'queued' | 'interrupt' }
): Promise<WorkflowRunSendMessageResult> {
  return callWorkflowRpc(
    settings,
    'workflow.run.sendMessage',
    params,
    WORKFLOW_RUN_ACTION_TIMEOUT_MS
  )
}

export function workflowRunReadNodeOutput(
  settings: RuntimeWorkflowSettings,
  params: { runId: string; attemptId: string; cursor?: string; limit?: number }
): Promise<OrchestrationWorkerReadResult> {
  return callWorkflowRpc(settings, 'workflow.run.readNodeOutput', params)
}

export function workflowRunEvents(
  settings: RuntimeWorkflowSettings,
  params: { runId: string; afterSeq?: number; limit?: number }
): Promise<WorkflowRunEventsResult> {
  return callWorkflowRpc(settings, 'workflow.run.events', params)
}

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
