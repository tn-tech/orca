import {
  catalogSupportsWorkerLaunchPreferences,
  getAgentSessionOptionCatalog
} from '../../../../../shared/agent-session-option-catalog'
import { TUI_AGENT_CONFIG } from '../../../../../shared/tui-agent-config'

/** Same predicate `workflow-node-dispatch.ts` uses on the host, so validation and dispatch agree
 *  on which agents accept a launch-time model/effort choice (FR-004, GraphValidationContext). */
export function agentSupportsModel(agent: string): boolean {
  return catalogSupportsWorkerLaunchPreferences(getAgentSessionOptionCatalog(agent))
}

/** The host agent registry — every agent id Orca can launch at all, independent of whether it's
 *  actually installed on this machine. Feeds `GraphValidationContext.isKnownAgent`. */
export function isKnownAgent(agent: string): boolean {
  return Object.hasOwn(TUI_AGENT_CONFIG, agent)
}
