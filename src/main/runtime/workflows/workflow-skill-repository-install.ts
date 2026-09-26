// Workspace-scope install of one repository skill through the skills CLI, recorded in the
// workspace's skill ledger so cleanup can undo it (FR-018, FR-021; research R9).
import type { ProcessResult } from '../../../shared/child-process/run-process'
import { buildAgentFeatureSkillInstallArgs } from '../../../shared/agent-feature-install-commands'
import { runKeyedSerializedOperation } from '../../cli/keyed-promise-queue'
import { joinWorktreeRelativePath } from '../runtime-relative-paths'
import { appendRunExcludeEntries, removeRunExcludeEntries } from './workflow-git-exclude'
import {
  clearPendingSkillInstall,
  readPendingSkillInstall,
  readSkillLedger,
  referenceLedgerPath,
  releaseSkillLedgerRun,
  restoreSkillSnapshot,
  skillBackupPath,
  writePendingSkillInstall,
  writeSkillLedger,
  type PendingInstallState,
  type SkillLedger
} from './workflow-skill-ledger'
import type {
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
const SKILLS_LOCK_FILE = 'skills-lock.json'
const workspaceQueues = new Map<string, Promise<void>>()

/** Concurrent `skills add` runs in one workspace race on its lock file and our ledger. */
export function withWorkspaceSkillLock<T>(
  workspaceRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  return runKeyedSerializedOperation(workspaceQueues, workspaceRoot, operation)
}

function outputTail(result: ProcessResult): string {
  const text = (result.stderr.trim() || result.stdout.trim()).slice(-2000)
  return text ? `: ${text}` : ''
}

/** Every path `skills add` writes: the canonical copy, the agent's link, the project lock file. */
function installCandidates(target: WorkflowSkillWorkspaceTarget, name: string): string[] {
  return [
    ...new Set([
      `${CANONICAL_WORKSPACE_SKILLS_DIR}/${name}`,
      `${target.skillsDir}/${name}`,
      SKILLS_LOCK_FILE
    ])
  ]
}

/** `true` installed, `false` already present, or the failure. */
export async function installRepositorySkill(
  input: RepositorySkillInstall,
  ports: WorkflowSkillProvisioningPorts
): Promise<boolean | Failed> {
  const { workspaceRoot, runId, target, name, location } = input
  const hostPath = (relative: string) => joinWorktreeRelativePath(workspaceRoot, relative)
  const skillPath = `${target.skillsDir}/${name}`
  const candidates = installCandidates(target, name)
  // Before "already present": an interrupted install may have left a half-written skill here.
  await recoverPendingSkillInstall(workspaceRoot, ports.fs)
  const ledger = await readSkillLedger(ports.fs, workspaceRoot)

  if (await ports.fs.exists(hostPath(skillPath))) {
    // Borrow whatever another run put here so its cleanup cannot pull it from under this one.
    const borrowed = candidates.filter((candidate) => ledger[candidate])
    for (const path of borrowed) {
      referenceLedgerPath(ledger, path, runId, 'created')
    }
    await commitLedger(input, ledger, borrowed, ports)
    return false
  }

  const tracked = await ports.listTrackedPaths(workspaceRoot, candidates)
  if (tracked.length > 0) {
    return {
      kind: 'failed',
      reason:
        `Skill "${name}" was not installed: the project already manages ${tracked.join(', ')} ` +
        'in version control, and installing would modify it. Commit the skill to the project instead.'
    }
  }

  const states = new Map<string, PendingInstallState>()
  for (const candidate of candidates) {
    if (ledger[candidate]) {
      states.set(candidate, 'shared')
    } else if (await ports.fs.exists(hostPath(candidate))) {
      await ports.fs.copyPath(hostPath(candidate), hostPath(skillBackupPath(candidate)))
      states.set(candidate, 'snapshot')
    } else {
      states.set(candidate, 'absent')
    }
  }

  // Snapshots first: a record naming a snapshot whose copy never finished would restore a torn copy.
  await writePendingSkillInstall(ports.fs, workspaceRoot, {
    runId,
    states: Object.fromEntries(states)
  })
  let failure: Failed | undefined
  try {
    failure = await runSkillsAdd(input, ports)
  } catch (error) {
    // Undo now if the host still answers; otherwise the pending record undoes it later.
    await undoPendingInstall(workspaceRoot, states, ports.fs).catch(() => undefined)
    throw error
  }
  if (failure || !(await ports.fs.exists(hostPath(skillPath)))) {
    await undoPendingInstall(workspaceRoot, states, ports.fs)
    return (
      failure ?? {
        kind: 'failed',
        reason: `Installing skill "${name}" from ${location} did not create ${skillPath}.`
      }
    )
  }

  const referenced: string[] = []
  for (const [candidate, state] of states) {
    if (state === 'absent' && !(await ports.fs.exists(hostPath(candidate)))) {
      continue
    }
    referenceLedgerPath(ledger, candidate, runId, state === 'snapshot' ? 'snapshot' : 'created')
    referenced.push(candidate)
  }
  await commitLedger(input, ledger, referenced, ports)
  return true
}

async function undoPendingInstall(
  workspaceRoot: string,
  states: ReadonlyMap<string, PendingInstallState>,
  fs: WorkflowSkillProvisioningPorts['fs']
): Promise<void> {
  await rollBack(workspaceRoot, states, fs)
  await clearPendingSkillInstall(fs, workspaceRoot)
}

/** Rolls back an install that a crash or lost connection interrupted, then drops its record. */
async function recoverPendingSkillInstall(
  workspaceRoot: string,
  fs: WorkflowSkillProvisioningPorts['fs']
): Promise<void> {
  const pending = await readPendingSkillInstall(fs, workspaceRoot)
  if (pending) {
    await undoPendingInstall(workspaceRoot, new Map(Object.entries(pending.states)), fs)
  }
}

async function runSkillsAdd(
  input: RepositorySkillInstall,
  ports: WorkflowSkillProvisioningPorts
): Promise<Failed | undefined> {
  const { name, location } = input
  let args: string[]
  try {
    args = buildAgentFeatureSkillInstallArgs([name], {
      source: location,
      global: false,
      yes: true,
      agents: [input.target.cliAgentKey]
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
  if (result.code === 0) {
    return undefined
  }
  const why = result.timedOut ? 'timed out' : `exited with code ${String(result.code)}`
  return {
    kind: 'failed',
    reason: `Installing skill "${name}" from ${location} ${why}${outputTail(result)}`
  }
}

/** Undoes a failed or partial install: new paths go, snapshotted user files come back. */
async function rollBack(
  workspaceRoot: string,
  states: ReadonlyMap<string, PendingInstallState>,
  fs: WorkflowSkillProvisioningPorts['fs']
): Promise<void> {
  for (const [candidate, state] of states) {
    if (state === 'absent') {
      await fs.removePath(joinWorktreeRelativePath(workspaceRoot, candidate))
    } else if (state === 'snapshot') {
      await restoreSkillSnapshot(fs, workspaceRoot, candidate)
    }
  }
}

/** Created paths are excluded per run; snapshotted user files keep their own git status. */
async function commitLedger(
  input: RepositorySkillInstall,
  ledger: SkillLedger,
  referenced: readonly string[],
  ports: WorkflowSkillProvisioningPorts
): Promise<void> {
  await writeSkillLedger(ports.fs, input.workspaceRoot, ledger)
  await clearPendingSkillInstall(ports.fs, input.workspaceRoot)
  const excluded = referenced.filter((path) => ledger[path]?.origin === 'created')
  const excludePath =
    excluded.length > 0 ? await ports.resolveGitExcludePath(input.workspaceRoot) : null
  if (excludePath) {
    await appendRunExcludeEntries(excludePath, input.runId, excluded, ports.fs)
  }
}

/** Releases the run's references, undoing paths no other run uses, and its exclude block. */
export function releaseRunSkillInstalls(
  run: { runId: string; workspaceRoot: string },
  ports: Pick<WorkflowSkillProvisioningPorts, 'fs' | 'resolveGitExcludePath'>
): Promise<void> {
  return withWorkspaceSkillLock(run.workspaceRoot, async () => {
    await recoverPendingSkillInstall(run.workspaceRoot, ports.fs)
    await releaseSkillLedgerRun(ports.fs, run.workspaceRoot, run.runId)
    const excludePath = await ports.resolveGitExcludePath(run.workspaceRoot)
    if (excludePath) {
      await removeRunExcludeEntries(excludePath, run.runId, ports.fs)
    }
  })
}
