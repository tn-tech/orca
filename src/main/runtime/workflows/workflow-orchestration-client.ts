import { randomUUID } from 'node:crypto'
import { isOrchestrationMutation } from '../../../shared/orchestration-rpc-contract'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { RpcDispatcher } from '../rpc/dispatcher'
import { engineCoordinatorHandle, type WorkflowEnginePrincipal } from './workflow-engine-principal'

export type WorkflowOrchestrationDispatcher = Pick<RpcDispatcher, 'dispatchAsWorkflowEngine'>

export type WorkflowOrchestrationClient = {
  call(method: `orchestration.${string}`, params: Record<string, unknown>): Promise<unknown>
}

/**
 * In-process caller for one workflow run: every orchestration.* call goes through the dispatcher's
 * handlers (fencing, receipts, relay, notifications) under the engine principal, never direct DB writes.
 */
export function createWorkflowOrchestrationClient(args: {
  dispatcher: WorkflowOrchestrationDispatcher
  principal: WorkflowEnginePrincipal
  createRequestId?: () => string
}): WorkflowOrchestrationClient {
  const createRequestId = args.createRequestId ?? randomUUID
  const clientId = engineCoordinatorHandle(args.principal.workflowRunId)
  return {
    async call(method, params) {
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
        { clientId, clientKind: 'runtime' }
      )
      if (!response.ok) {
        throw new OrchestrationError(
          response.error.code,
          response.error.message,
          response.error.data
        )
      }
      return response.result
    }
  }
}
