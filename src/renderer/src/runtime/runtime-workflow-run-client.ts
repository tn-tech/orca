// Run-lifecycle half of runtime-workflow-client.ts, split out to keep that file ≤300 lines;
// re-exported from there so existing `@/runtime/runtime-workflow-client` imports keep working.
// Imports the RPC primitive from the leaf module (never from runtime-workflow-client.ts itself,
// which re-exports this file) to avoid a circular import between the two.
import type { OrchestrationWorkerReadResult } from '../../../shared/orchestration-worker-output'
import type { WorkflowRunState } from '../../../shared/workflows/workflow-node-states'
import type {
  NodeAttemptView,
  RoleProposalView,
  RunEventView,
  RunMessageView,
  RunQuestionView,
  RunSnapshot,
  RunSummary,
  WorkflowRunSource
} from '../../../shared/workflows/workflow-run-types'
import {
  callWorkflowRpc,
  WORKFLOW_RUN_ACTION_TIMEOUT_MS,
  type RuntimeWorkflowSettings
} from './runtime-workflow-rpc'

/** `workflow.run.show` result: the run row plus its attempts/questions/messages and event tail.
 *  `proposals` (US7, T118) is optional — an older host predating Reflection proposals omits it. */
export type WorkflowRunSnapshotView = RunSnapshot & {
  attempts: NodeAttemptView[]
  questions: RunQuestionView[]
  messages: RunMessageView[]
  events: RunEventView[]
  proposals?: RoleProposalView[]
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
