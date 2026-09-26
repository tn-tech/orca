import {
  catalogSupportsWorkerLaunchPreferences,
  getAgentSessionOptionCatalog
} from '../../../../../shared/agent-session-option-catalog'

/** Same predicate `workflow-node-dispatch.ts` uses on the host, so validation and dispatch agree
 *  on which agents accept a launch-time model/effort choice (FR-004, GraphValidationContext). */
export function agentSupportsModel(agent: string): boolean {
  return catalogSupportsWorkerLaunchPreferences(getAgentSessionOptionCatalog(agent))
}
