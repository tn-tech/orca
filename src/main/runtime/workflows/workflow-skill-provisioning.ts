// Ensures a node's skills are available before its agent launches (FR-018, FR-018a, FR-020,
// FR-021; research R9). Host-agnostic: every effect goes through the ports below, so the local
// wiring (workflow-skill-provisioning-host.ts) and the SSH/WSL wiring share this logic.
//
// Ports:
// - `runProcess` + `npxCommand`: runs `npx --yes skills add <location> --skill <name>
//   --agent <key> -y` with the run workspace as cwd, on the execution host.
// - `fs`: host paths for presence checks, the install record and `.git/info/exclude`.
// - `resolveGitExcludePath(root)`: the exclude file git reads for `root`; `null` = no git.
// - `plugins`: host-scope plugin skills. `isInstalled` checks presence; `install` runs the
//   provider's own plugin command and returns `{ ok: false, reason }` when it has none.
// - `trust`: the per-host trust store (FR-018a). `decide({ source })` answers `trusted`,
//   `refused`, or `needs-question` when no decision is recorded yet.
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/run-process'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'
import type { GitExcludeFileAccess } from './workflow-git-exclude'
import { installRepositorySkill, withWorkspaceSkillLock } from './workflow-skill-repository-install'
import { workflowSkillWorkspaceTarget } from './workflow-skill-workspace-target'
import {
  isWorkflowSourceAllowed,
  WORKFLOW_SOURCE_NOT_ALLOWED_CODE
} from './workflow-source-allowlist'

export { releaseRunSkillInstalls } from './workflow-skill-repository-install'

export type WorkflowSkillFilesystem = GitExcludeFileAccess & {
  exists(path: string): Promise<boolean>
  /** Recursive; a missing path is not an error. */
  removePath(path: string): Promise<void>
}

export type WorkflowPluginInstallResult = { ok: true } | { ok: false; reason: string }

export type WorkflowPluginSkillPort = {
  isInstalled(request: { plugin: string; skill: string; agent: string }): Promise<boolean>
  install(request: { plugin: string; agent: string }): Promise<WorkflowPluginInstallResult>
}

export type WorkflowSkillTrustDecision = 'trusted' | 'refused' | 'needs-question'

export type WorkflowSkillTrustGate = {
  decide(request: { source: string }): Promise<WorkflowSkillTrustDecision>
}

export type WorkflowSkillProvisioningPorts = {
  runProcess(spec: ProcessSpec): Promise<ProcessResult>
  npxCommand: string
  npxEnv?: NodeJS.ProcessEnv
  fs: WorkflowSkillFilesystem
  resolveGitExcludePath(workspaceRoot: string): Promise<string | null>
  plugins: WorkflowPluginSkillPort
  trust: WorkflowSkillTrustGate
}

export type WorkflowSkillAllowlist = { sources: readonly string[]; location: string }

export type ProvisionNodeSkillsInput = {
  runId: string
  agent: string
  skills: readonly SkillReference[]
  /** Host-appropriate run workspace root. */
  workspaceRoot: string
  /** Read only when a repository skill needs it. */
  readAllowlist(): Promise<WorkflowSkillAllowlist>
}

/** FR-018a: what a person is asked before a host-scope install from `source`. */
export type WorkflowSkillTrustQuestion = { source: string; skills: string[]; agents: string[] }

export type WorkflowSkillProvisioningOutcome =
  | {
      kind: 'ready'
      /** Skills installed by this call; already-present skills are not listed. */
      installed: string[]
      /** FR-020: the agent cannot load workspace skills, so the brief must inline these. */
      promptFallback?: { agent: string; skills: SkillReference[] }
    }
  | { kind: 'failed'; reason: string; code?: string; allowlistPath?: string }
  | { kind: 'trust-required'; question: WorkflowSkillTrustQuestion }

type Failed = Extract<WorkflowSkillProvisioningOutcome, { kind: 'failed' }>

// Why: the name becomes a path segment and a CLI argument.
const SAFE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Serialised per workspace: concurrent `skills add` runs race on the same lock file. */
export function provisionNodeSkills(
  input: ProvisionNodeSkillsInput,
  ports: WorkflowSkillProvisioningPorts
): Promise<WorkflowSkillProvisioningOutcome> {
  if (input.skills.length === 0) {
    return Promise.resolve({ kind: 'ready', installed: [] })
  }
  return withWorkspaceSkillLock(input.workspaceRoot, () => provisionSerialized(input, ports))
}

async function provisionSerialized(
  input: ProvisionNodeSkillsInput,
  ports: WorkflowSkillProvisioningPorts
): Promise<WorkflowSkillProvisioningOutcome> {
  const unsafe = input.skills.find((skill) => !SAFE_SKILL_NAME.test(skill.name))
  if (unsafe) {
    return { kind: 'failed', reason: `Skill name "${unsafe.name}" is not a valid skill name.` }
  }
  const pluginSkills = input.skills.flatMap((skill) =>
    skill.source.kind === 'plugin' ? [{ skill, plugin: skill.source.plugin }] : []
  )
  const repositorySkills = input.skills.flatMap((skill) =>
    skill.source.kind === 'repository' ? [{ skill, location: skill.source.location }] : []
  )
  const target = workflowSkillWorkspaceTarget(input.agent)

  // Every refusal is decided before anything is installed, so a refused node leaves no trace.
  const missingPlugins = await pluginsToInstall(input.agent, pluginSkills, ports)
  const trustBlock = await checkPluginTrust(input.agent, missingPlugins, ports)
  if (trustBlock) {
    return trustBlock
  }
  if (repositorySkills.length > 0) {
    const refusal = checkAllowlist(repositorySkills, await input.readAllowlist())
    if (refusal) {
      return refusal
    }
  }

  const installed: string[] = []
  for (const [plugin, skills] of missingPlugins) {
    const result = await ports.plugins.install({ plugin, agent: input.agent })
    if (!result.ok && skills.some((skill) => skill.required)) {
      const names = skills.map((skill) => skill.name).join(', ')
      return {
        kind: 'failed',
        reason: `Could not install plugin "${plugin}" for skill(s) ${names}: ${result.reason}`
      }
    }
    if (result.ok) {
      installed.push(...skills.map((skill) => skill.name))
    }
  }

  if (!target) {
    const fallback = repositorySkills.map((entry) => entry.skill)
    return fallback.length === 0
      ? { kind: 'ready', installed }
      : { kind: 'ready', installed, promptFallback: { agent: input.agent, skills: fallback } }
  }
  for (const { skill, location } of repositorySkills) {
    const result = await installRepositorySkill(
      { ...input, target, name: skill.name, location },
      ports
    )
    if (typeof result !== 'boolean') {
      // An optional skill that cannot be installed does not block the node.
      if (!skill.required) {
        continue
      }
      return result
    }
    if (result) {
      installed.push(skill.name)
    }
  }
  return { kind: 'ready', installed }
}

async function pluginsToInstall(
  agent: string,
  pluginSkills: readonly { skill: SkillReference; plugin: string }[],
  ports: WorkflowSkillProvisioningPorts
): Promise<Map<string, SkillReference[]>> {
  const missing = new Map<string, SkillReference[]>()
  for (const { skill, plugin } of pluginSkills) {
    if (await ports.plugins.isInstalled({ plugin, skill: skill.name, agent })) {
      continue
    }
    missing.set(plugin, [...(missing.get(plugin) ?? []), skill])
  }
  return missing
}

async function checkPluginTrust(
  agent: string,
  missing: ReadonlyMap<string, readonly SkillReference[]>,
  ports: WorkflowSkillProvisioningPorts
): Promise<WorkflowSkillProvisioningOutcome | undefined> {
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

function checkAllowlist(
  repositorySkills: readonly { skill: SkillReference; location: string }[],
  allowlist: WorkflowSkillAllowlist
): Failed | undefined {
  const blocked = repositorySkills.find(
    ({ location }) => !isWorkflowSourceAllowed(location, allowlist.sources)
  )
  if (!blocked) {
    return undefined
  }
  return {
    kind: 'failed',
    code: WORKFLOW_SOURCE_NOT_ALLOWED_CODE,
    allowlistPath: allowlist.location,
    reason:
      `Skill "${blocked.skill.name}" comes from "${blocked.location}", which is not on the project ` +
      `allowlist. Add it to workflows.allowedSources in ${allowlist.location}.`
  }
}

/**
 * Why a node cannot launch yet, or `undefined` when it can. A trust question fails the node
 * until the Waiting-and-ask flow exists (FR-018a); the reason names the source to trust.
 */
export function provisioningBlockReason(
  outcome: WorkflowSkillProvisioningOutcome
): string | undefined {
  if (outcome.kind === 'failed') {
    return outcome.reason
  }
  if (outcome.kind === 'trust-required') {
    const { source, skills } = outcome.question
    return (
      `Plugin source "${source}" has not been trusted on this host, so skill(s) ` +
      `${skills.join(', ')} were not installed.`
    )
  }
  return undefined
}
