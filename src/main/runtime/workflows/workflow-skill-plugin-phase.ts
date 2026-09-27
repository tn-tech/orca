// The plugin half of node skill provisioning (FR-018, FR-018a): which plugin skills are missing
// on the executing host, whether their provider can install them at all, whether their source
// is trusted there, and then the install itself, verified afterwards.
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'
import {
  isWorkflowPluginId,
  WORKFLOW_PLUGIN_ID_MESSAGE
} from '../../../shared/workflows/workflow-plugin-id'
import type {
  WorkflowSkillProvisioningOutcome,
  WorkflowSkillProvisioningPorts
} from './workflow-skill-provisioning'

type Failed = Extract<WorkflowSkillProvisioningOutcome, { kind: 'failed' }>
type TrustRequired = Extract<WorkflowSkillProvisioningOutcome, { kind: 'trust-required' }>
type MissingPlugins = Map<string, SkillReference[]>

/** Decides every plugin refusal before anything is installed. */
export async function planPluginInstalls(
  agent: string,
  pluginSkills: readonly { skill: SkillReference; plugin: string }[],
  ports: WorkflowSkillProvisioningPorts
): Promise<{ missing: MissingPlugins } | Failed | TrustRequired> {
  const invalid = pluginSkills.find(({ plugin }) => !isWorkflowPluginId(plugin))
  if (invalid) {
    return {
      kind: 'failed',
      reason: `Skill "${invalid.skill.name}" names plugin "${invalid.plugin}": ${WORKFLOW_PLUGIN_ID_MESSAGE}`
    }
  }
  const missing = await pluginsToInstall(agent, pluginSkills, ports)
  return (
    dropUninstallablePlugins(agent, missing, ports) ??
    (await checkPluginTrust(agent, missing, ports)) ?? { missing }
  )
}

export async function installPluginSkills(
  agent: string,
  missing: ReadonlyMap<string, readonly SkillReference[]>,
  ports: WorkflowSkillProvisioningPorts
): Promise<{ installed: string[] } | Failed> {
  const installed: string[] = []
  for (const [plugin, skills] of missing) {
    const result = await ports.plugins.install({ plugin, agent })
    if (!result.ok && skills.some((skill) => skill.required)) {
      const names = skills.map((skill) => skill.name).join(', ')
      return {
        kind: 'failed',
        reason: `Could not install plugin "${plugin}" for skill(s) ${names}: ${result.reason}`
      }
    }
    if (!result.ok) {
      continue
    }
    const absent = await absentAfterInstall(agent, plugin, skills, ports)
    if (absent.some((skill) => skill.required)) {
      return {
        kind: 'failed',
        reason:
          `Plugin "${plugin}" installed, but skill(s) ${absent.map((s) => s.name).join(', ')} ` +
          'are still not available to the agent on this host (is the plugin enabled?).'
      }
    }
    installed.push(...skills.filter((skill) => !absent.includes(skill)).map((s) => s.name))
  }
  return { installed }
}

async function pluginsToInstall(
  agent: string,
  pluginSkills: readonly { skill: SkillReference; plugin: string }[],
  ports: WorkflowSkillProvisioningPorts
): Promise<MissingPlugins> {
  const missing: MissingPlugins = new Map()
  for (const { skill, plugin } of pluginSkills) {
    if (await ports.plugins.isInstalled({ plugin, skill: skill.name, agent })) {
      continue
    }
    missing.set(plugin, [...(missing.get(plugin) ?? []), skill])
  }
  return missing
}

/** Verify-only providers: a required skill fails the node; an optional one is dropped. */
function dropUninstallablePlugins(
  agent: string,
  missing: MissingPlugins,
  ports: WorkflowSkillProvisioningPorts
): Failed | undefined {
  for (const [plugin, skills] of missing) {
    const reason = ports.plugins.unavailableReason({ plugin, agent })
    if (reason === undefined) {
      continue
    }
    if (skills.some((skill) => skill.required)) {
      return { kind: 'failed', reason }
    }
    missing.delete(plugin)
  }
  return undefined
}

async function absentAfterInstall(
  agent: string,
  plugin: string,
  skills: readonly SkillReference[],
  ports: WorkflowSkillProvisioningPorts
): Promise<SkillReference[]> {
  const absent: SkillReference[] = []
  for (const skill of skills) {
    if (!(await ports.plugins.isInstalled({ plugin, skill: skill.name, agent }))) {
      absent.push(skill)
    }
  }
  return absent
}

async function checkPluginTrust(
  agent: string,
  missing: ReadonlyMap<string, readonly SkillReference[]>,
  ports: WorkflowSkillProvisioningPorts
): Promise<Failed | TrustRequired | undefined> {
  for (const [source, skills] of missing) {
    const decision = await ports.trust.decide({ source })
    if (decision === 'refused') {
      return {
        kind: 'failed',
        reason: `Plugin source "${source}" is not trusted on this host, so skill(s) ${skills.map((s) => s.name).join(', ')} were not installed.`
      }
    }
    if (decision === 'needs-question') {
      return {
        kind: 'trust-required',
        question: { source, skills: skills.map((skill) => skill.name), agents: [agent] }
      }
    }
  }
  return undefined
}
