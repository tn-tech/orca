import type { WorkflowRunChangedPayload } from '../../shared/runtime-client-events'

/** Local desktop IPC for workflow-run change notifications; workflow.* CRUD/run
 *  calls ride the runtime RPC surface (`runtime:call`) like automations. */
export type WorkflowsApi = {
  onChanged: (callback: (payload: WorkflowRunChangedPayload) => void) => () => void
}
