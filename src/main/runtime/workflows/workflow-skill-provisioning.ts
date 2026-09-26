// Ensures a node's skills are available before its agent launches (FR-018, FR-018a, FR-020,
// FR-021; research R9). Host-agnostic: every effect goes through the ports below, so the local
// wiring (workflow-skill-provisioning-host.ts) and the SSH/WSL wiring share this logic.
//
// Ports:
// - `runProcess` + `npxCommand`: runs `npx --yes skills add <location> --skill <name>
//   --agent <key> -y` with the run workspace as cwd, on the execution host.
// - `fs`: host paths for presence checks, the install record and `.git/info/exclude`.
// - `resolveGitExcludePath(root)`: the exclude file git reads for `root`; `null` = no git.
// - `listTrackedPaths(root, paths)`: which install targets git already tracks (never modified).
// - `plugins`: host-scope plugin skills (workflow-plugin-install.ts). `isInstalled` checks
//   presence; `unavailableReason` names a verify-only provider; `install` runs the provider's
//   own verified plugin command.
// - `trust`: the per-host trust store (FR-018a, workflow-source-trust.ts). `decide({ source })`
//   answers `trusted`, `refused`, or `needs-question` when no decision is recorded yet.
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/run-process'
import type { SkillReference } from '../../../shared/workflows/workflow-definition-types'
import type { GitExcludeFileAccess } from './workflow-git-exclude'
import { installPluginSkills, planPluginInstalls } from './workflow-skill-plugin-phase'
import { installRepositorySkill, withWorkspaceSkillLock } from './workflow-skill-repository-install'
import { workflowSkillWorkspaceTarget } from './workflow-skill-workspace-target'
import {
  isWorkflowSourceAllowed,
  sourceNotAllowedMessage,
  WORKFLOW_SOURCE_NOT_ALLOWED_CODE
} from './workflow-source-allowlist'

export { releaseRunSkillInstalls } from './workflow-skill-repository-install'

export type WorkflowSkillFilesystem = GitExcludeFileAccess & {
  exists(path: string): Promise<boolean>
  /** Recursive; a missing path is not an error. */
  removePath(path: string): Promise<void>
  /** Recursive copy that keeps symlinks as links; creates missing parents. */
  copyPath(from: string, to: string): Promise<void>
}

export type WorkflowPluginInstallResult = { ok: true } | { ok: false; reason: string }

export type WorkflowPluginSkillPort = {
  isInstalled(request: { plugin: string; skill: string; agent: string }): Promise<boolean>
  /** Install instructions when `agent` has no verified plugin command (verify-only). */
  unavailableReason(request: { plugin: string; agent: string }): string | undefined
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
  /** The subset of workspace-relative paths git tracks there; `[]` without git. */
  listTrackedPaths(workspaceRoot: string, relativePaths: readonly string[]): Promise<string[]>
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
export type WorkflowSkillTrustQuestion = {
  source: string
  skills: string[]
  agents: string[]
  /** The executing host's trust key (workflow-source-trust.ts); set by the host wiring. */
  host?: string
}

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
  const plugins = await planPluginInstalls(input.agent, pluginSkills, ports)
  if ('kind' in plugins) {
    return plugins
  }
  if (repositorySkills.length > 0) {
    const refusal = checkAllowlist(repositorySkills, await input.readAllowlist())
    if (refusal) {
      return refusal
    }
  }

  const pluginInstall = await installPluginSkills(input.agent, plugins.missing, ports)
  if ('kind' in pluginInstall) {
    return pluginInstall
  }
  const installed = [...pluginInstall.installed]

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
    reason: `Skill "${blocked.skill.name}" source ${sourceNotAllowedMessage(blocked.location, allowlist.location)}`
  }
}

/**
 * Why a node cannot launch yet, or `undefined` when it can. A trust question reads as a failure
 * only for callers that cannot wait for the answer (FR-018a); the reason names the source.
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
