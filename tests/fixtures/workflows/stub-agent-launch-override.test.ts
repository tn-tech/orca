import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasExplicitTuiLaunchCommand } from '../../../src/shared/tui-agent-launch-command-override'
import {
  createStubAgentLaunchOverrides,
  STUB_AGENT_SCRIPT_PATH
} from './stub-agent-launch-override'

describe('createStubAgentLaunchOverrides', () => {
  it('points at the checked-in stub agent script', () => {
    expect(existsSync(STUB_AGENT_SCRIPT_PATH)).toBe(true)
    expect(STUB_AGENT_SCRIPT_PATH.endsWith('workflow-stub-agent.mjs')).toBe(true)
  })

  it('overrides claude and codex only', () => {
    const overrides = createStubAgentLaunchOverrides()
    expect(Object.keys(overrides).sort()).toEqual(['claude', 'codex'])
    expect(overrides.claude).toContain(STUB_AGENT_SCRIPT_PATH)
    expect(overrides.codex).toContain(STUB_AGENT_SCRIPT_PATH)
  })

  it("validates against tui-agent-launch-command-override.ts's accepted shape", () => {
    const agentCmdOverrides = createStubAgentLaunchOverrides()
    expect(hasExplicitTuiLaunchCommand({ agentCmdOverrides }, 'claude')).toBe(true)
    expect(hasExplicitTuiLaunchCommand({ agentCmdOverrides }, 'codex')).toBe(true)
    expect(hasExplicitTuiLaunchCommand({ agentCmdOverrides }, 'gemini')).toBe(false)
  })
})
