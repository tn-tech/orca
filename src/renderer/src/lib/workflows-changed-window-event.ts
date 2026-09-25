/** Renderer-internal fan-out for workflow-run change notifications, so run
 *  views refresh without every publisher knowing about them. */
import type { WorkflowRunChangedPayload } from '../../../shared/runtime-client-events'

export const WORKFLOWS_CHANGED_EVENT = 'orca:workflows-changed'

/** `environmentId` names the runtime authority that published; absent means desktop. */
export type WorkflowsChangedWindowDetail = Partial<WorkflowRunChangedPayload> & {
  environmentId?: string | null
}

export function emitWorkflowsChangedWindowEvent(detail: WorkflowsChangedWindowDetail): void {
  window.dispatchEvent(
    new CustomEvent<WorkflowsChangedWindowDetail>(WORKFLOWS_CHANGED_EVENT, { detail })
  )
}

/** Missing or malformed detail degrades to an unscoped desktop event, never a dropped one. */
export function workflowsChangedWindowDetail(event: Event): WorkflowsChangedWindowDetail {
  if (!(event instanceof CustomEvent)) {
    return {}
  }
  const detail: unknown = event.detail
  return detail && typeof detail === 'object' ? detail : {}
}
