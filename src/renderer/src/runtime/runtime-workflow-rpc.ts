// Leaf module for every `workflow.*` RPC call: `runtime-workflow-client.ts` and
// `runtime-workflow-run-client.ts` both depend on this (never on each other), so neither imports
// the other and there's no cycle.
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'

export type RuntimeWorkflowSettings =
  | Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>
  | null
  | undefined

const WORKFLOW_RPC_TIMEOUT_MS = 15_000
// Why: run mutations may wait on the workflow engine (start/pause/rerun/etc.); give them room.
export const WORKFLOW_RUN_ACTION_TIMEOUT_MS = 30_000
// Why above the server's own planner deadline (workflow-draft-planner.ts's DRAFT_DEADLINE_MS,
// currently 14 minutes): the RPC must outlive it so the server's response — a definition, or its
// own timeout problem — always arrives before the client gives up first.
export const WORKFLOW_DRAFT_TIMEOUT_MS = 15 * 60_000 + 30_000

export function callWorkflowRpc<TResult>(
  settings: RuntimeWorkflowSettings,
  method: string,
  params?: unknown,
  timeoutMs = WORKFLOW_RPC_TIMEOUT_MS
): Promise<TResult> {
  return callRuntimeRpc<TResult>(getActiveRuntimeTarget(settings), method, params, { timeoutMs })
}
