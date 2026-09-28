// Run-view types mirroring the workflow_* tables (data-model.md §3), camelCase with ISO
// timestamp strings for host/renderer/CLI/mobile consumption. Not the DB row shapes themselves.
import type { JsonValue } from './workflow-condition-schema'
import type { Node, Workflow } from './workflow-definition-types'
import type { WorkflowAttemptState, WorkflowRunState } from './workflow-node-states'
import type { SkillReference } from './workflow-skill-reference-schema'

export type WorkflowRunSource = 'project' | 'personal'

/** `workflow_runs`, full row including the definition snapshot. */
export type RunSnapshot = {
  id: string
  workflowName: string
  workflowSource: WorkflowRunSource
  workflowSnapshot: Workflow
  workflowVersion: string
  objective: string
  repoId: string
  worktreeId?: string
  orchestrationRunId?: string
  state: WorkflowRunState
  concurrencyLimit: number
  startedByClient?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  rerunOfRunId?: string
  rerunFromNodeId?: string
}

/** `workflow_runs`, list-view row (omits the full definition snapshot). */
export type RunSummary = Omit<RunSnapshot, 'workflowSnapshot'>

export type WorkflowLaunchReceipt = { agent: string; model?: string; effort?: string }
export type WorkflowAttemptArtifact = { path: string; exists: boolean }
export type WorkflowTranscriptRef = { kind: 'dispatch' | 'session'; id: string }

/** `workflow_node_attempts`. */
export type NodeAttemptView = {
  id: string
  runId: string
  nodeId: string
  nodeType: Node['type']
  iteration: number
  attemptIndex: number
  taskId?: string
  dispatchId?: string
  state: WorkflowAttemptState
  requestedLaunch?: WorkflowLaunchReceipt
  effectiveLaunch?: WorkflowLaunchReceipt
  briefPath?: string
  resultPath?: string
  resultJson?: JsonValue
  artifactsJson: WorkflowAttemptArtifact[]
  failureReason?: string
  /**
   * Optional machine-readable code for `failureReason` (workflow-attempt-failure-code.ts), e.g.
   * `agent_readiness_timeout`. Open vocabulary: an unknown or missing code falls back to the text.
   */
  failureCode?: string
  workspaceWorktreeId?: string
  transcriptRef?: WorkflowTranscriptRef
  startedAt?: string
  finishedAt?: string
}

export type WorkflowQuestionKind = 'approval' | 'agent-question' | 'trust'
export type WorkflowQuestionState = 'pending' | 'answered' | 'escalated' | 'expired'

/** `workflow_run_questions`. */
export type RunQuestionView = {
  id: string
  runId: string
  attemptId: string
  kind: WorkflowQuestionKind
  gateId?: string
  questionMessageId?: string
  prompt: string
  optionsJson: JsonValue
  state: WorkflowQuestionState
  answer?: string
  answeredBy?: string
  answeredAt?: string
  timeoutAt?: string
  escalationAt?: string
}

export type WorkflowMessageMode = 'queued' | 'interrupt'
export type WorkflowMessageState = 'queued' | 'delivered' | 'failed'

/** `workflow_run_messages`. */
export type RunMessageView = {
  id: string
  runId: string
  attemptId: string
  sender: string
  text: string
  mode: WorkflowMessageMode
  state: WorkflowMessageState
  createdAt: string
  deliveredAt?: string
}

/** `workflow_run_events`: timestamped transitions for the run view and history. */
export type RunEventView = {
  id: string
  runId: string
  attemptId?: string
  kind: string
  payloadJson: JsonValue
  createdAt: string
}

/** A Reflection's proposed change: each set field replaces the role's own value whole. */
export type RoleProposalChange = { systemPrompt?: string; skills?: SkillReference[] }
export type RoleProposalState = 'proposed' | 'accepted' | 'exported' | 'rejected'

/** `workflow_role_proposals`: one Reflection proposal, tied to the run and attempt that made it. */
export type RoleProposalView = {
  id: string
  runId: string
  attemptId: string
  roleId: string
  change: RoleProposalChange
  evidence: string
  state: RoleProposalState
}
