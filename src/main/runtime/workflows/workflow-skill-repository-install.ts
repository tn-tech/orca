// Workspace-scope install of one repository skill through the skills CLI, plus the durable record
// and `.git/info/exclude` entries that let cleanup undo it (FR-018, FR-021; research R9).
import type { ProcessResult } from '../../../shared/child-process/run-process'
import { buildAgentFeatureSkillInstallArgs } from '../../../shared/agent-feature-install-commands'
import { runKeyedSerializedOperation } from '../../cli/keyed-promise-queue'
import { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from '../runtime-relative-paths'
import { appendRunExcludeEntries, removeRunExcludeEntries } from './workflow-git-exclude'
import type {
  WorkflowSkillFilesystem,
  WorkflowSkillProvisioningOutcome,
  WorkflowSkillProvisioningPorts
} from './workflow-skill-provisioning'
import {
  CANONICAL_WORKSPACE_SKILLS_DIR,
  type WorkflowSkillWorkspaceTarget
} from './workflow-skill-workspace-target'

type Failed = Extract<WorkflowSkillProvisioningOutcome, { kind: 'failed' }>

export type RepositorySkillInstall = {
  runId: string
  workspaceRoot: string
  target: WorkflowSkillWorkspaceTarget
  name: string
  location: string
}

const SKILLS_CLI_TIMEOUT_MS = 5 * 60_000
const workspaceQueues = new Map<string, Promise<void>>()
const SKILLS_LOCK_FILE = 'skills-lock.json'

function installRecordPath(runId: string): string {
  return `.orca/workflow-runs/${runId}/provisioned-skills.json`
}

function outputTail(result: ProcessResult): string {
  const text = (result.stderr.trim() || result.stdout.trim()).slice(-2000)
  return text ? `: ${text}` : ''
}

/** `true` installed, `false` already present, or the failure. */
export async function installRepositorySkill(
  input: RepositorySkillInstall,
  ports: WorkflowSkillProvisioningPorts
): Promise<boolean | Failed> {
  const { target, name, location } = input
  const hostPath = (relative: string) => joinWorktreeRelativePath(input.workspaceRoot, relative)
  const skillPath = `${target.skillsDir}/${name}`
  if (await ports.fs.exists(hostPath(skillPath))) {
    return false
  }
  // Why: the CLI writes the canonical copy, links it into the agent dir, and a project lock file.
  const candidates = [
    ...new Set([`${CANONICAL_WORKSPACE_SKILLS_DIR}/${name}`, skillPath, SKILLS_LOCK_FILE])
  ]
  const existedBefore = new Set<string>()
  for (const candidate of candidates) {
    if (await ports.fs.exists(hostPath(candidate))) {
      existedBefore.add(candidate)
    }
  }
  let args: string[]
  try {
    args = buildAgentFeatureSkillInstallArgs([name], {
      source: location,
      global: false,
      yes: true,
      agents: [target.cliAgentKey]
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'failed', reason: `Cannot install skill "${name}": ${message}` }
  }
  const result = await ports.runProcess({
    program: ports.npxCommand,
    // Why `--yes` twice: npx's skips its fetch prompt, the CLI's skips its agent picker.
    args: ['--yes', ...args],
    cwd: input.workspaceRoot,
    ...(ports.npxEnv ? { env: ports.npxEnv } : {}),
    timeoutMs: SKILLS_CLI_TIMEOUT_MS
  })
  if (result.code !== 0) {
    const why = result.timedOut ? 'timed out' : `exited with code ${String(result.code)}`
    return {
      kind: 'failed',
      reason: `Installing skill "${name}" from ${location} ${why}${outputTail(result)}`
    }
  }
  if (!(await ports.fs.exists(hostPath(skillPath)))) {
    return {
      kind: 'failed',
      reason: `Installing skill "${name}" from ${location} did not create ${skillPath}.`
    }
  }
  const created: string[] = []
  for (const candidate of candidates) {
    if (!existedBefore.has(candidate) && (await ports.fs.exists(hostPath(candidate)))) {
      created.push(candidate)
    }
  }
  await recordInstalledPaths(input, created, ports)
  return true
}

function isSafeRecordedPath(entry: unknown): entry is string {
  if (typeof entry !== 'string') {
    return false
  }
  try {
    return normalizeRuntimeRelativePath(entry) === entry
  } catch {
    return false
  }
}

async function readInstallRecord(
  fs: WorkflowSkillFilesystem,
  recordPath: string
): Promise<string[]> {
  const text = await fs.readText(recordPath)
  if (!text) {
    return []
  }
  const parsed: unknown = JSON.parse(text)
  // Why: the record sits in the agent's workspace; never let it steer a delete outside it.
  return Array.isArray(parsed) ? parsed.filter(isSafeRecordedPath) : []
}

/** The record outlives this process, so cleanup works after a restart and without git. */
async function recordInstalledPaths(
  input: RepositorySkillInstall,
  created: readonly string[],
  ports: WorkflowSkillProvisioningPorts
): Promise<void> {
  const recordPath = joinWorktreeRelativePath(input.workspaceRoot, installRecordPath(input.runId))
  const recorded = await readInstallRecord(ports.fs, recordPath)
  await ports.fs.writeText(recordPath, JSON.stringify([...new Set([...recorded, ...created])]))
  const excludePath = await ports.resolveGitExcludePath(input.workspaceRoot)
  if (excludePath) {
    await appendRunExcludeEntries(excludePath, input.runId, created, ports.fs)
  }
}

/** Removes what the run installed and its exclude entries (FR-021). Idempotent. */
export function releaseRunSkillInstalls(
  run: { runId: string; workspaceRoot: string },
  ports: Pick<WorkflowSkillProvisioningPorts, 'fs' | 'resolveGitExcludePath'>
): Promise<void> {
  return withWorkspaceSkillLock(run.workspaceRoot, async () => {
    const recordPath = joinWorktreeRelativePath(run.workspaceRoot, installRecordPath(run.runId))
    for (const relative of await readInstallRecord(ports.fs, recordPath)) {
      await ports.fs.removePath(joinWorktreeRelativePath(run.workspaceRoot, relative))
    }
    await ports.fs.removePath(recordPath)
    const excludePath = await ports.resolveGitExcludePath(run.workspaceRoot)
    if (excludePath) {
      await removeRunExcludeEntries(excludePath, run.runId, ports.fs)
    }
  })
}

/** Concurrent `skills add` runs in one workspace race on its lock file and our record. */
export function withWorkspaceSkillLock<T>(
  workspaceRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  return runKeyedSerializedOperation(workspaceQueues, workspaceRoot, operation)
}
