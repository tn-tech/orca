// Resolves a node's role + overrides, starts its worker through the engine principal, and
// records what was requested vs what actually launched (FR-017, FR-024, FR-026, US1 AS4/AS5).
import { getAgentSessionOptionCatalog } from '../../../shared/agent-session-option-catalog'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { WorkflowAttemptState } from '../../../shared/workflows/workflow-node-states'
import type {
  NodeAttemptView,
  WorkflowLaunchReceipt
} from '../../../shared/workflows/workflow-run-types'
import { engineCoordinatorHandle } from './workflow-engine-principal'
import type { BriefNode } from './workflow-brief-builder'
import type { WorkflowOrchestrationClient } from './workflow-orchestration-client'

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

/** Same gate as worker-launch-preferences.ts: no catalog or no launch-time model args, no support. */
function agentSupportsLaunchModel(agent: string): boolean {
  const catalog = getAgentSessionOptionCatalog(agent)
  return Boolean(catalog?.supportsWorkerLaunchPreferences && catalog.modelApply.launchArgs)
}

type WorkerStartLaunchSelection = {
  agent: string | null
  model: string | null
  effort: string | null
}
type ParsedWorkerStartResult = {
  dispatchId?: string
  state?: string
  lastError?: string
  requested?: WorkerStartLaunchSelection
  effective?: WorkerStartLaunchSelection | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function asLaunchSelection(value: unknown): WorkerStartLaunchSelection | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const { agent, model, effort } = value
  if (!isStringOrNull(agent) || !isStringOrNull(model) || !isStringOrNull(effort)) {
    return undefined
  }
  return { agent, model, effort }
}

/** `orchestration.workerStart`'s result is `unknown` on the wire; pull out only what dispatch needs. */
function parseWorkerStartResult(result: unknown): ParsedWorkerStartResult {
  if (!isPlainObject(result)) {
    return {}
  }
  const dispatchId = typeof result.dispatchId === 'string' ? result.dispatchId : undefined
  const state = typeof result.state === 'string' ? result.state : undefined
  const lastError = typeof result.lastError === 'string' ? result.lastError : undefined
  const launch = result.launch
  if (!isPlainObject(launch)) {
    return { dispatchId, state, lastError }
  }
  return {
    dispatchId,
    state,
    lastError,
    requested: asLaunchSelection(launch.requested),
    effective: launch.effective === null ? null : asLaunchSelection(launch.effective)
  }
}

function toLaunchReceipt(
  selection: WorkerStartLaunchSelection | undefined
): WorkflowLaunchReceipt | undefined {
  if (!selection?.agent) {
    return undefined
  }
  return {
    agent: selection.agent,
    ...(selection.model ? { model: selection.model } : {}),
    ...(selection.effort ? { effort: selection.effort } : {})
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
    }
  ): NodeAttemptView | undefined
}

export type DispatchWorkflowNodeArgs = {
  port: WorkflowNodeDispatchPort
  attemptStore: WorkflowAttemptDispatchStore
  runId: string
  attemptId: string
  /** The Task already created for this node (workflow-frontier.ts createNodeTask, U14). */
  taskId: string
  node: BriefNode
  roles: Workflow['roles']
}

export type DispatchWorkflowNodeOutcome =
  | { ok: true; attempt: NodeAttemptView | undefined }
  | { ok: false; attempt: NodeAttemptView | undefined; failureReason: string }

/**
 * Starts the node's worker under the engine principal and records the result on the attempt.
 * Always enters `provisioning` first (data-model.md §4: `provisioning` = before `worker-start`),
 * then `running` on success or `failed` on any failure — no retry (controller ruling).
 *
 * Placement always targets the run workspace (the engine's own `worktreeId`, applied by
 * `assertWorkflowEngineWorkerStart`); child-workspace placement (`node.workspace === 'child'`)
 * is a later unit's seam (child-lineage-note.md) and is not yet honored here.
 */
export async function dispatchWorkflowNode(
  args: DispatchWorkflowNodeArgs
): Promise<DispatchWorkflowNodeOutcome> {
  const { port, attemptStore, runId, attemptId, taskId, node, roles } = args

  function fail(reason: string, dispatchId?: string): DispatchWorkflowNodeOutcome {
    attemptStore.updateWorkflowAttempt(attemptId, {
      failureReason: reason,
      ...(dispatchId ? { dispatchId } : {})
    })
    const attempt = attemptStore.transitionWorkflowAttempt(attemptId, 'failed')
    return { ok: false, attempt, failureReason: reason }
  }

  attemptStore.transitionWorkflowAttempt(attemptId, 'provisioning')

  let launch: ResolvedNodeLaunch
  try {
    launch = resolveNodeLaunch(node, roles)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }

  const supportsModel = agentSupportsLaunchModel(launch.agent)
  const params: Record<string, unknown> = {
    from: engineCoordinatorHandle(runId),
    task: taskId,
    agent: launch.agent,
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

  const requestedLaunch = toLaunchReceipt(parsed.requested)
  const effectiveLaunch = toLaunchReceipt(parsed.effective ?? undefined)
  attemptStore.updateWorkflowAttempt(attemptId, {
    ...(parsed.dispatchId ? { dispatchId: parsed.dispatchId } : {}),
    ...(requestedLaunch ? { requestedLaunch } : {}),
    ...(effectiveLaunch ? { effectiveLaunch } : {})
  })
  const attempt = attemptStore.transitionWorkflowAttempt(attemptId, 'running')
  return { ok: true, attempt }
}
