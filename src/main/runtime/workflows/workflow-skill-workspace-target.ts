// Where an agent loads workspace-scope skills from, and the `skills --agent` key that installs
// there (research R9). An agent with neither gets its skills inlined in the prompt (FR-020).
import {
  isSkillInstallProviderId,
  skillInstallProvider
} from '../../../shared/skill-install-providers'
import {
  SKILLS_CLI_AGENT_KEY_BY_TUI_AGENT,
  SKILLS_CLI_UNIVERSAL_AGENT_KEY
} from '../../../shared/skills-cli-agent-keys'

/** The skills CLI's own project-scope root; universal agents read it directly. */
export const CANONICAL_WORKSPACE_SKILLS_DIR = '.agents/skills'

export type WorkflowSkillWorkspaceTarget = {
  /** Workspace-relative, `/`-separated directory the agent reads skills from. */
  skillsDir: string
  cliAgentKey: string
}

function skillsCliAgentKey(agent: string): string | null {
  const entry = Object.entries(SKILLS_CLI_AGENT_KEY_BY_TUI_AGENT).find(([id]) => id === agent)
  return entry?.[1] ?? null
}

/** `undefined` means the agent cannot load skills from a workspace: use the prompt fallback. */
export function workflowSkillWorkspaceTarget(
  agent: string
): WorkflowSkillWorkspaceTarget | undefined {
  if (!isSkillInstallProviderId(agent)) {
    return undefined
  }
  const provider = skillInstallProvider(agent)
  if (!provider) {
    return undefined
  }
  if (provider.workspaceSegments === null) {
    // Why: `universal` writes only the canonical root, which is all these agents read.
    return {
      skillsDir: CANONICAL_WORKSPACE_SKILLS_DIR,
      cliAgentKey: skillsCliAgentKey(agent) ?? SKILLS_CLI_UNIVERSAL_AGENT_KEY
    }
  }
  const cliAgentKey = skillsCliAgentKey(agent)
  return cliAgentKey ? { skillsDir: provider.workspaceSegments.join('/'), cliAgentKey } : undefined
}
