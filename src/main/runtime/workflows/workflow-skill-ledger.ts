// Per-workspace record of paths workflow runs installed or modified, with the runs that rely on
// each one (FR-021). In-place runs share the user's folder, so a path is undone only when the last
// run referencing it is released. Kept on disk so cleanup works after a restart and without git.
import { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from '../runtime-relative-paths'
import type { WorkflowSkillFilesystem } from './workflow-skill-provisioning'

/** `created`: absent before a run installed it. `snapshot`: untracked user file, restored after. */
export type SkillLedgerEntry = { origin: 'created' | 'snapshot'; runs: string[] }
export type SkillLedger = Record<string, SkillLedgerEntry>

const LEDGER_PATH = '.orca/workflow-skills/ledger.json'
const PENDING_INSTALL_PATH = '.orca/workflow-skills/pending-install.json'
const BACKUP_DIR = '.orca/workflow-skills/backups'

export function skillBackupPath(relativePath: string): string {
  return `${BACKUP_DIR}/${relativePath}`
}

// Why: the ledger sits in the agent's workspace; never let it steer a delete outside it.
function isSafeRelativePath(entry: string): boolean {
  try {
    return normalizeRuntimeRelativePath(entry) === entry
  } catch {
    return false
  }
}

function parseEntry(value: unknown): SkillLedgerEntry | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const origin: unknown = Reflect.get(value, 'origin')
  const runs: unknown = Reflect.get(value, 'runs')
  if ((origin !== 'created' && origin !== 'snapshot') || !Array.isArray(runs)) {
    return undefined
  }
  return { origin, runs: runs.filter((run): run is string => typeof run === 'string') }
}

export async function readSkillLedger(
  fs: WorkflowSkillFilesystem,
  workspaceRoot: string
): Promise<SkillLedger> {
  const text = await fs.readText(joinWorktreeRelativePath(workspaceRoot, LEDGER_PATH))
  if (!text) {
    return {}
  }
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null) {
    return {}
  }
  const ledger: SkillLedger = {}
  for (const [path, value] of Object.entries(parsed)) {
    const entry = parseEntry(value)
    if (entry && isSafeRelativePath(path)) {
      ledger[path] = entry
    }
  }
  return ledger
}

export async function writeSkillLedger(
  fs: WorkflowSkillFilesystem,
  workspaceRoot: string,
  ledger: SkillLedger
): Promise<void> {
  const ledgerPath = joinWorktreeRelativePath(workspaceRoot, LEDGER_PATH)
  if (Object.keys(ledger).length === 0) {
    await fs.removePath(ledgerPath)
    return
  }
  await fs.writeText(ledgerPath, JSON.stringify(ledger))
}

export function referenceLedgerPath(
  ledger: SkillLedger,
  path: string,
  runId: string,
  origin: SkillLedgerEntry['origin']
): void {
  const entry = ledger[path] ?? { origin, runs: [] }
  if (!entry.runs.includes(runId)) {
    entry.runs.push(runId)
  }
  ledger[path] = entry
}

/** Puts a snapshotted user file back and drops its backup. */
export async function restoreSkillSnapshot(
  fs: WorkflowSkillFilesystem,
  workspaceRoot: string,
  path: string
): Promise<void> {
  const target = joinWorktreeRelativePath(workspaceRoot, path)
  const backup = joinWorktreeRelativePath(workspaceRoot, skillBackupPath(path))
  if (!(await fs.exists(backup))) {
    return
  }
  await fs.removePath(target)
  await fs.copyPath(backup, target)
  await fs.removePath(backup)
}

/** Drops `runId` everywhere; undoes each path no other run still references. */
export async function releaseSkillLedgerRun(
  fs: WorkflowSkillFilesystem,
  workspaceRoot: string,
  runId: string
): Promise<void> {
  const ledger = await readSkillLedger(fs, workspaceRoot)
  for (const [path, entry] of Object.entries(ledger)) {
    if (!entry.runs.includes(runId)) {
      continue
    }
    entry.runs = entry.runs.filter((run) => run !== runId)
    if (entry.runs.length > 0) {
      continue
    }
    await (entry.origin === 'created'
      ? fs.removePath(joinWorktreeRelativePath(workspaceRoot, path))
      : restoreSkillSnapshot(fs, workspaceRoot, path))
    delete ledger[path]
  }
  await writeSkillLedger(fs, workspaceRoot, ledger)
}

/**
 * Per candidate path before an install: another run's ledger entry, an untracked user file that
 * was snapshotted, or nothing yet.
 */
export type PendingInstallState = 'shared' | 'snapshot' | 'absent'

/**
 * Write-ahead record of an install in flight. It outlives a crash or a lost SSH connection, so
 * the next provision or release in the workspace can undo whatever the interrupted CLI wrote.
 */
export type PendingSkillInstall = { runId: string; states: Record<string, PendingInstallState> }

function isPendingState(value: unknown): value is PendingInstallState {
  return value === 'shared' || value === 'snapshot' || value === 'absent'
}

export async function readPendingSkillInstall(
  fs: WorkflowSkillFilesystem,
  workspaceRoot: string
): Promise<PendingSkillInstall | undefined> {
  const text = await fs.readText(joinWorktreeRelativePath(workspaceRoot, PENDING_INSTALL_PATH))
  if (!text) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A torn write means the install never started: the record lands before the CLI runs.
    return { runId: '', states: {} }
  }
  const runId: unknown = typeof parsed === 'object' && parsed ? Reflect.get(parsed, 'runId') : null
  const rawStates: unknown =
    typeof parsed === 'object' && parsed ? Reflect.get(parsed, 'states') : null
  const states: Record<string, PendingInstallState> = {}
  if (typeof rawStates === 'object' && rawStates !== null) {
    for (const [path, state] of Object.entries(rawStates)) {
      if (isPendingState(state) && isSafeRelativePath(path)) {
        states[path] = state
      }
    }
  }
  return { runId: typeof runId === 'string' ? runId : '', states }
}

export async function writePendingSkillInstall(
  fs: WorkflowSkillFilesystem,
  workspaceRoot: string,
  pending: PendingSkillInstall
): Promise<void> {
  await fs.writeText(
    joinWorktreeRelativePath(workspaceRoot, PENDING_INSTALL_PATH),
    JSON.stringify(pending)
  )
}

export async function clearPendingSkillInstall(
  fs: WorkflowSkillFilesystem,
  workspaceRoot: string
): Promise<void> {
  await fs.removePath(joinWorktreeRelativePath(workspaceRoot, PENDING_INSTALL_PATH))
}

/**
 * Whether the recorded install already committed: a path it found absent or snapshotted now
 * carries its run in the ledger. Only a commit writes those, since `shared` paths are excluded.
 */
export function isPendingInstallCommitted(
  pending: PendingSkillInstall,
  ledger: SkillLedger
): boolean {
  return Object.entries(pending.states).some(
    ([path, state]) => state !== 'shared' && ledger[path]?.runs.includes(pending.runId) === true
  )
}

/** Drops leftover backups (e.g. from a torn record) when no ledger entry restores from one. */
export async function removeUnneededSkillBackups(
  fs: WorkflowSkillFilesystem,
  workspaceRoot: string,
  ledger: SkillLedger
): Promise<void> {
  if (Object.values(ledger).some((entry) => entry.origin === 'snapshot')) {
    return
  }
  await fs.removePath(joinWorktreeRelativePath(workspaceRoot, BACKUP_DIR))
}
