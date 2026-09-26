// Per-workspace record of paths workflow runs installed or modified, with the runs that rely on
// each one (FR-021). In-place runs share the user's folder, so a path is undone only when the last
// run referencing it is released. Kept on disk so cleanup works after a restart and without git.
import { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from '../runtime-relative-paths'
import type { WorkflowSkillFilesystem } from './workflow-skill-provisioning'

/** `created`: absent before a run installed it. `snapshot`: untracked user file, restored after. */
export type SkillLedgerEntry = { origin: 'created' | 'snapshot'; runs: string[] }
export type SkillLedger = Record<string, SkillLedgerEntry>

const LEDGER_PATH = '.orca/workflow-skills/ledger.json'
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
