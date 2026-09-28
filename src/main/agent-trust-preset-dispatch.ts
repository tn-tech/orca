import {
  type AgentTrustPreset,
  markAntigravityWorkspaceTrusted,
  markCodexProjectTrusted,
  markCopilotFolderTrusted,
  markCursorWorkspaceTrusted
} from './agent-trust-presets'
import { markKimiWorkspaceTrusted } from './kimi/kimi-workspace-trust'

/**
 * Writes `preset`'s trust artifact for a workspace on this machine. The one local dispatch every
 * launch path shares (runtime startup, renderer IPC, IPC worktree create), so a new preset cannot
 * be wired into one path and silently missed by another. Resolves once the write has landed;
 * errors propagate so each caller keeps its own best-effort policy.
 */
export async function markLocalAgentWorkspaceTrusted(
  preset: AgentTrustPreset,
  workspacePath: string
): Promise<void> {
  switch (preset) {
    case 'cursor':
      markCursorWorkspaceTrusted(workspacePath)
      return
    case 'copilot':
      markCopilotFolderTrusted(workspacePath)
      return
    case 'codex':
      // Why: the Codex write queues behind any in-flight hook grant; the agent must not launch first.
      await markCodexProjectTrusted(workspacePath)
      return
    case 'antigravity':
      markAntigravityWorkspaceTrusted(workspacePath)
      return
    case 'kimi':
      await markKimiWorkspaceTrusted(workspacePath)
  }
}
