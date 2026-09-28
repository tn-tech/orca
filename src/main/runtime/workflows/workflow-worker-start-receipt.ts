// Reads what `orchestration.workerStart` reported launching and records it on the attempt: the
// requested vs effective agent/model/effort (FR-017, FR-035) and, for a child-workspace node, the
// worktree the worker landed in. A restart that adopts an accepted Dispatch records the same.
import type {
  NodeAttemptView,
  WorkflowLaunchReceipt
} from '../../../shared/workflows/workflow-run-types'

type WorkerStartLaunchSelection = {
  agent: string | null
  model: string | null
  effort: string | null
}
export type ParsedWorkerStartResult = {
  dispatchId?: string
  state?: string
  lastError?: string
  /** The worker-start stage that failed, e.g. `agent_readiness`. */
  failedStage?: string
  requested?: WorkerStartLaunchSelection
  effective?: WorkerStartLaunchSelection | null
  /** The worktree the placement effect landed on, whether created or reused. */
  worktreeId?: string
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

/** The worker-start receipt's `effects` always includes one `kind: 'worktree'` entry — created or reused. */
function extractWorktreeEffectId(effects: unknown): string | undefined {
  if (!Array.isArray(effects)) {
    return undefined
  }
  for (const effect of effects) {
    if (isPlainObject(effect) && effect.kind === 'worktree' && typeof effect.id === 'string') {
      return effect.id
    }
  }
  return undefined
}

/** `orchestration.workerStart`'s result is `unknown` on the wire; pull out only what dispatch needs. */
export function parseWorkerStartResult(result: unknown): ParsedWorkerStartResult {
  if (!isPlainObject(result)) {
    return {}
  }
  const dispatchId = typeof result.dispatchId === 'string' ? result.dispatchId : undefined
  const state = typeof result.state === 'string' ? result.state : undefined
  const lastError = typeof result.lastError === 'string' ? result.lastError : undefined
  const failedStage = typeof result.failedStage === 'string' ? result.failedStage : undefined
  const worktreeId = extractWorktreeEffectId(result.effects)
  const launch = result.launch
  if (!isPlainObject(launch)) {
    return { dispatchId, state, lastError, failedStage, worktreeId }
  }
  return {
    dispatchId,
    state,
    lastError,
    failedStage,
    worktreeId,
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

/** The attempt fields the dispatch success path writes from a ready worker-start receipt. */
export function recordStartedWorker(
  attemptStore: {
    updateWorkflowAttempt(
      id: string,
      patch: {
        dispatchId?: string
        requestedLaunch?: WorkflowLaunchReceipt
        effectiveLaunch?: WorkflowLaunchReceipt
        workspaceWorktreeId?: string
      }
    ): NodeAttemptView | undefined
  },
  attemptId: string,
  parsed: ParsedWorkerStartResult,
  childWorkspace: boolean
): void {
  const requestedLaunch = toLaunchReceipt(parsed.requested)
  const effectiveLaunch = toLaunchReceipt(parsed.effective ?? undefined)
  attemptStore.updateWorkflowAttempt(attemptId, {
    ...(parsed.dispatchId ? { dispatchId: parsed.dispatchId } : {}),
    ...(requestedLaunch ? { requestedLaunch } : {}),
    ...(effectiveLaunch ? { effectiveLaunch } : {}),
    ...(childWorkspace && parsed.worktreeId ? { workspaceWorktreeId: parsed.worktreeId } : {})
  })
}
