import { randomUUID } from 'node:crypto'
import { isOrchestrationMutation } from '../../../shared/orchestration-rpc-contract'
import {
  ORCHESTRATION_CONTRACT_VERSION,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from '../../../shared/protocol-version'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { RpcDispatcher } from '../rpc/dispatcher'
import { engineCoordinatorHandle, type WorkflowEnginePrincipal } from './workflow-engine-principal'

export type WorkflowOrchestrationDispatcher = Pick<RpcDispatcher, 'dispatchAsWorkflowEngine'>

export type WorkflowOrchestrationClient = {
  call(method: `orchestration.${string}`, params: Record<string, unknown>): Promise<unknown>
}

/** Direct input into a worker's own session: "interrupt now" follow-ups (FR-036a). */
export type WorkflowWorkerInputMethod = 'terminal.send' | 'agentSession.send'

export type WorkflowWorkerInputClient = {
  call(method: WorkflowWorkerInputMethod, params: Record<string, unknown>): Promise<unknown>
}

type WorkflowEngineClientArgs = {
  dispatcher: WorkflowOrchestrationDispatcher
  principal: WorkflowEnginePrincipal
  createRequestId?: () => string
}

function createEngineCaller(
  args: WorkflowEngineClientArgs,
  options: { clientCapabilities?: (typeof STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY)[] } = {}
) {
  const createRequestId = args.createRequestId ?? randomUUID
  const clientId = engineCoordinatorHandle(args.principal.workflowRunId)
  return async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = createRequestId()
    const response = await args.dispatcher.dispatchAsWorkflowEngine(
      {
        id,
        authToken: 'workflow-engine',
        method,
        params,
        orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
        // Why: a fresh id per mutation gives each one its own durable receipt.
        ...(isOrchestrationMutation(method, params) ? { orchestrationRequestId: id } : {})
      },
      args.principal,
      { clientId, clientKind: 'runtime', ...options }
    )
    if (!response.ok) {
      throw new OrchestrationError(response.error.code, response.error.message, response.error.data)
    }
    return response.result
  }
}

/**
 * In-process caller for one workflow run: every orchestration.* call goes through the dispatcher's
 * handlers (fencing, receipts, relay, notifications) under the engine principal, never direct DB writes.
 */
export function createWorkflowOrchestrationClient(
  args: WorkflowEngineClientArgs
): WorkflowOrchestrationClient {
  return { call: createEngineCaller(args) }
}

/**
 * The same engine principal for worker input. Why the capability: `agentSession.*` refuses a
 * `runtime` client that did not negotiate it; this caller is the same build as the host.
 */
export function createWorkflowWorkerInputClient(
  args: WorkflowEngineClientArgs
): WorkflowWorkerInputClient {
  return {
    call: createEngineCaller(args, {
      clientCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
    })
  }
}
