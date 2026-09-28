// Resolves a node's role + overrides, starts its worker through the engine principal, and
// records what was requested vs what actually launched (FR-017, FR-024, FR-026, US1 AS4/AS5).
import {
  catalogSupportsWorkerLaunchPreferences,
  getAgentSessionOptionCatalog
} from '../../../shared/agent-session-option-catalog'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import { childWorkspaceDisallowedMessage } from '../../../shared/workflows/workflow-graph-validation'
import type { WorkflowAttemptState } from '../../../shared/workflows/workflow-node-states'
import type {
  NodeAttemptView,
  WorkflowLaunchReceipt
} from '../../../shared/workflows/workflow-run-types'
import { engineCoordinatorHandle } from './workflow-engine-principal'
import { parseWorkerStartResult, recordStartedWorker } from './workflow-worker-start-receipt'
import type { BriefNode } from './workflow-brief-builder'
import type { WorkflowOrchestrationClient } from './workflow-orchestration-client'
import {
  provisioningBlockReason,
  type WorkflowSkillProvisioningOutcome,
  type WorkflowSkillTrustQuestion
} from './workflow-skill-provisioning'

export type ResolvedNodeLaunch = {
  agent: string
  model?: string
  effort?: string
  systemPrompt: string
}

/** Node overrides win field-by-field over the assigned role (FR-017, data-model.md §1). */
export function resolveNodeLaunch(node: BriefNode, roles: Workflow['roles']): ResolvedNodeLaunch {
  const role = node.roleId === undefined ? undefined : roles[node.roleId]
  const agent = node.overrides?.agent ?? role?.agent
  if (!agent) {
    throw new Error(`Node "${node.id}" has no agent: neither its role nor its overrides set one.`)
  }
  return {
    agent,
    model: node.overrides?.model ?? role?.model,
    effort: node.overrides?.effort ?? role?.effort,
    systemPrompt: node.overrides?.systemPrompt ?? role?.systemPrompt ?? ''
  }
}

export type WorkflowNodeDispatchPort = Pick<WorkflowOrchestrationClient, 'call'>

/**
 * Own method signatures rather than `Pick<OrchestrationDb, ...>`: the store's methods carry an
 * explicit `this: OrchestrationDb`, which only a real `OrchestrationDb` instance can satisfy.
 */
export type WorkflowAttemptDispatchStore = {
  transitionWorkflowAttempt(id: string, toState: WorkflowAttemptState): NodeAttemptView | undefined
  updateWorkflowAttempt(
    id: string,
    patch: {
      dispatchId?: string
      requestedLaunch?: WorkflowLaunchReceipt
      effectiveLaunch?: WorkflowLaunchReceipt
      failureReason?: string
      workspaceWorktreeId?: string
    }
  ): NodeAttemptView | undefined
}

export type DispatchWorkflowNodeArgs = {
  port: WorkflowNodeDispatchPort
  attemptStore: WorkflowAttemptDispatchStore
  runId: string
  attemptId: string
  /** The Task already created for this node (workflow-frontier-node-task.ts createNodeTask, U14). */
  taskId: string
  node: BriefNode
  roles: Workflow['roles']
  workspacePolicy: Workflow['workspacePolicy']
  /** Installs the node's skills for `agent` while the attempt is `provisioning` (FR-018). */
  provisionSkills?: (agent: string) => Promise<WorkflowSkillProvisioningOutcome>
  /**
   * Parks the still-`provisioning` attempt in `waiting` on a trust question (FR-018a). Without
   * it, a trust question fails the node.
   */
  onTrustRequired?: (question: WorkflowSkillTrustQuestion) => NodeAttemptView | undefined
  /** The attempt is already `provisioning`: a restart interrupted it before worker-start. */
  resumeProvisioning?: boolean
}

export type DispatchWorkflowNodeOutcome =
  | { ok: true; attempt: NodeAttemptView | undefined }
  | { ok: false; attempt: NodeAttemptView | undefined; failureReason: string }
  | {
      ok: false
      attempt: NodeAttemptView | undefined
      /** Not a failure: the attempt waits in `waiting` for a person to trust the source. */
      waitingForTrust: WorkflowSkillTrustQuestion
      failureReason?: undefined
    }

/**
 * Starts the node's worker under the engine principal and records the result on the attempt.
 * Always enters `provisioning` first (data-model.md §4: `provisioning` = before `worker-start`),
 * then `running` on success or `failed` on any failure — no retry (controller ruling).
 *
 * `node.workspace === 'child'` requests `worktree: 'new-child'` placement, with the run workspace
 * as parent (`assertWorkflowEngineWorkerStart` resolves that parent from the engine principal);
 * everything else places in the run workspace itself (FR-025). `in-place` workflows (folder
 * workspaces, FR-041) have no worktree to parent a child from — graph validation already refuses
 * this combination (`graph_child_workspace_disallowed`), and this is the engine's own defense.
 */
export async function dispatchWorkflowNode(
  args: DispatchWorkflowNodeArgs
): Promise<DispatchWorkflowNodeOutcome> {
  const { port, attemptStore, runId, attemptId, taskId, node, roles, workspacePolicy } = args
  const wantsChildWorkspace = node.type === 'agent' && node.workspace === 'child'

  function fail(reason: string, dispatchId?: string): DispatchWorkflowNodeOutcome {
    attemptStore.updateWorkflowAttempt(attemptId, {
      failureReason: reason,
      ...(dispatchId ? { dispatchId } : {})
    })
    const attempt = attemptStore.transitionWorkflowAttempt(attemptId, 'failed')
    return { ok: false, attempt, failureReason: reason }
  }

  if (!args.resumeProvisioning) {
    attemptStore.transitionWorkflowAttempt(attemptId, 'provisioning')
  }

  if (wantsChildWorkspace && workspacePolicy === 'in-place') {
    return fail(childWorkspaceDisallowedMessage(node.id))
  }

  let launch: ResolvedNodeLaunch
  try {
    launch = resolveNodeLaunch(node, roles)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }

  if (args.provisionSkills) {
    let provisioned: WorkflowSkillProvisioningOutcome
    try {
      provisioned = await args.provisionSkills(launch.agent)
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
    if (provisioned.kind === 'trust-required' && args.onTrustRequired) {
      const attempt = args.onTrustRequired(provisioned.question)
      return { ok: false, attempt, waitingForTrust: provisioned.question }
    }
    const blocked = provisioningBlockReason(provisioned)
    if (blocked !== undefined) {
      return fail(blocked)
    }
  }

  const supportsModel = catalogSupportsWorkerLaunchPreferences(
    getAgentSessionOptionCatalog(launch.agent)
  )
  const params: Record<string, unknown> = {
    from: engineCoordinatorHandle(runId),
    task: taskId,
    agent: launch.agent,
    ...(wantsChildWorkspace ? { worktree: 'new-child' } : {}),
    ...(supportsModel && launch.model ? { model: launch.model } : {}),
    ...(supportsModel && launch.model && launch.effort ? { effort: launch.effort } : {})
  }

  let raw: unknown
  try {
    raw = await port.call('orchestration.workerStart', params)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }

  const parsed = parseWorkerStartResult(raw)
  if (parsed.state !== 'ready') {
    return fail(
      parsed.lastError ?? `workerStart returned unexpected state "${parsed.state ?? 'unknown'}".`,
      parsed.dispatchId
    )
  }

  recordStartedWorker(attemptStore, attemptId, parsed, wantsChildWorkspace)
  const attempt = attemptStore.transitionWorkflowAttempt(attemptId, 'running')
  return { ok: true, attempt }
}
