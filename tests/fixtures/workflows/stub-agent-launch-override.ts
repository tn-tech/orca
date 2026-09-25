/**
 * Launch command overrides that route `claude` and `codex` panes to the
 * deterministic stub agent (config/scripts/workflow-stub-agent.mjs) instead
 * of the real CLI. In the shape `agentCmdOverrides` (and
 * `hasExplicitTuiLaunchCommand` in src/shared/tui-agent-launch-command-override.ts)
 * expect: a plain command string per agent, resolved via the host shell.
 *
 * Callers still need to set the `WORKFLOW_STUB_SCRIPT`, `ORCA`, and (for a
 * direct, non-brief invocation) `WORKFLOW_STUB_NODE_ID`/`WORKFLOW_STUB_ITERATION`
 * env vars before launching so the stub has a scripted response to play.
 */
import { resolve } from 'node:path'
import type { TuiAgent } from '../../../src/shared/tui-agent'

/** Absolute path to the stub agent script; assumes `node` is on the launch shell's PATH. */
export const STUB_AGENT_SCRIPT_PATH = resolve(
  __dirname,
  '../../../config/scripts/workflow-stub-agent.mjs'
)

export function createStubAgentLaunchOverrides(): Partial<Record<TuiAgent, string>> {
  return {
    claude: `node ${STUB_AGENT_SCRIPT_PATH}`,
    codex: `node ${STUB_AGENT_SCRIPT_PATH}`
  }
}
