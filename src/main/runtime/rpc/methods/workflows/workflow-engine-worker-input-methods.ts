import { STRUCTURED_AGENT_SESSION_METHODS } from '../structured-agent-session'
import { TERMINAL_SEND_METHODS } from '../terminal/terminal-send-method'

/** What the workflow engine's dispatcher serves beyond orchestration.*: "interrupt now" follow-ups
 *  (FR-036a) write straight into a worker's terminal or structured session. */
export const WORKFLOW_ENGINE_WORKER_INPUT_METHODS = [
  ...TERMINAL_SEND_METHODS,
  ...STRUCTURED_AGENT_SESSION_METHODS.filter((method) => method.name === 'agentSession.send')
]
