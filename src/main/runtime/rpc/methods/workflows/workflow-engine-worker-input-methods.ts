import { STRUCTURED_AGENT_SESSION_METHODS } from '../structured-agent-session'

/** What the workflow engine's dispatcher serves beyond orchestration.*: "interrupt now" follow-ups
 *  (FR-036a) into a structured worker's session. Terminal workers are written through the runtime's
 *  agent-prompt writer directly (workflow-follow-up-delivery.ts), not an RPC. */
// Targets are scoped by construction (the run's own attempt dispatch), not by the engine principal.
export const WORKFLOW_ENGINE_WORKER_INPUT_METHODS = STRUCTURED_AGENT_SESSION_METHODS.filter(
  (method) => method.name === 'agentSession.send'
)
