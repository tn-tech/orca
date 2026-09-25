import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import type { Repo } from '../../../shared/repo-types'
import type { Workflow, WorkflowProblem } from '../../../shared/workflows/workflow-definition-types'
import { parseWorkflowDefinition } from '../../../shared/workflows/workflow-definition-schema'
import type { WorkflowRunSource } from '../../../shared/workflows/workflow-run-types'
import { isENOENT } from '../../ipc/filesystem-auth'
import { joinWorktreeRelativePath } from '../runtime-relative-paths'
import { readEffectiveWorkflowsDirectory } from './workflow-orca-yaml-config'
import {
  getProjectWorkflowFilesystem,
  localWorkflowFilesystem,
  personalWorkflowsDirectory,
  type WorkflowFilesystem
} from './workflow-file-store-filesystem'

/** Where a workflow file lives: the project's `orca-workflows/` (shared) or `~/.orca/workflows/` (personal). */
export type WorkflowFileSource = WorkflowRunSource

export type WorkflowFileListingEntry = { name: string; source: WorkflowFileSource }

export type WorkflowFileReadResult = {
  definition: Workflow | undefined
  raw: string
  /** sha256 hex of `raw`; pass back as `expectedRevision` on write for optimistic concurrency. */
  revision: string
  problems: WorkflowProblem[]
}

export type WorkflowFileWriteResult = { revision: string }

const WORKFLOW_FILE_SUFFIX = '.workflow.yaml'

/** Thrown by `writeWorkflow` when `raw` does not parse into a valid workflow definition. */
export class WorkflowFileValidationError extends Error {
  constructor(readonly problems: WorkflowProblem[]) {
    super('workflow_file_invalid')
    this.name = 'WorkflowFileValidationError'
  }
}

function assertValidWorkflowName(name: string): void {
  if (
    !name ||
    name !== name.trim() ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..')
  ) {
    throw new Error('workflow_name_invalid')
  }
}

function workflowFileName(name: string): string {
  return `${name}${WORKFLOW_FILE_SUFFIX}`
}

function contentRevision(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function parseWorkflowFileContent(raw: string): {
  definition: Workflow | undefined
  problems: WorkflowProblem[]
} {
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (error) {
    return {
      definition: undefined,
      problems: [
        {
          code: 'workflow_file_yaml_invalid',
          message: error instanceof Error ? error.message : String(error),
          severity: 'error'
        }
      ]
    }
  }
  return parseWorkflowDefinition(parsed)
}

function filesystemForSource(repo: Repo, source: WorkflowFileSource): WorkflowFilesystem {
  return source === 'personal' ? localWorkflowFilesystem : getProjectWorkflowFilesystem(repo)
}

async function resolveWorkflowsDirPath(repo: Repo, source: WorkflowFileSource): Promise<string> {
  if (source === 'personal') {
    return personalWorkflowsDirectory()
  }
  const directory = await readEffectiveWorkflowsDirectory(repo)
  return joinWorktreeRelativePath(repo.path, directory)
}

async function resolveWorkflowFilePath(
  repo: Repo,
  source: WorkflowFileSource,
  name: string
): Promise<string> {
  const dirPath = await resolveWorkflowsDirPath(repo, source)
  return joinWorktreeRelativePath(dirPath, workflowFileName(name))
}

async function listWorkflowFileNames(fs: WorkflowFilesystem, dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readDir(dirPath)
    return entries
      .filter((entry) => !entry.isDirectory && entry.name.endsWith(WORKFLOW_FILE_SUFFIX))
      .map((entry) => entry.name.slice(0, -WORKFLOW_FILE_SUFFIX.length))
  } catch (error) {
    if (isENOENT(error)) {
      return []
    }
    throw error
  }
}

/** Lists project and personal workflow files. Project wins when a name exists in both (§5). */
export async function listWorkflows(repo: Repo): Promise<WorkflowFileListingEntry[]> {
  const [projectDirPath, projectFs] = [
    await resolveWorkflowsDirPath(repo, 'project'),
    getProjectWorkflowFilesystem(repo)
  ]
  const personalDirPath = personalWorkflowsDirectory()
  const [projectNames, personalNames] = await Promise.all([
    listWorkflowFileNames(projectFs, projectDirPath),
    listWorkflowFileNames(localWorkflowFilesystem, personalDirPath)
  ])
  const bySource = new Map<string, WorkflowFileSource>()
  for (const name of personalNames) {
    bySource.set(name, 'personal')
  }
  for (const name of projectNames) {
    bySource.set(name, 'project')
  }
  return Array.from(bySource, ([name, source]) => ({ name, source })).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
}

export async function readWorkflow(
  repo: Repo,
  source: WorkflowFileSource,
  name: string
): Promise<WorkflowFileReadResult> {
  assertValidWorkflowName(name)
  const filePath = await resolveWorkflowFilePath(repo, source, name)
  const fs = filesystemForSource(repo, source)
  let raw: string
  try {
    raw = await fs.readFile(filePath)
  } catch (error) {
    if (isENOENT(error)) {
      throw new Error('workflow_file_not_found')
    }
    throw error
  }
  const { definition, problems } = parseWorkflowFileContent(raw)
  return { definition, raw, revision: contentRevision(raw), problems }
}

async function readCurrentRevision(
  fs: WorkflowFilesystem,
  filePath: string
): Promise<string | null> {
  try {
    return contentRevision(await fs.readFile(filePath))
  } catch (error) {
    if (isENOENT(error)) {
      return null
    }
    throw error
  }
}

/**
 * Writes `raw` (validated against the U03 schema) at `<source>/<name>.workflow.yaml`.
 * `expectedRevision: null` means "create" and fails `workflow_file_conflict` if the file already
 * exists; a revision string must match the file's current content hash or the write is rejected
 * the same way — the file may have changed underneath the caller.
 */
export async function writeWorkflow(
  repo: Repo,
  source: WorkflowFileSource,
  name: string,
  raw: string,
  expectedRevision: string | null
): Promise<WorkflowFileWriteResult> {
  assertValidWorkflowName(name)
  const { definition, problems } = parseWorkflowFileContent(raw)
  if (!definition) {
    throw new WorkflowFileValidationError(problems)
  }
  const dirPath = await resolveWorkflowsDirPath(repo, source)
  const filePath = joinWorktreeRelativePath(dirPath, workflowFileName(name))
  const fs = filesystemForSource(repo, source)
  const existingRevision = await readCurrentRevision(fs, filePath)
  const conflict =
    expectedRevision === null ? existingRevision !== null : existingRevision !== expectedRevision
  if (conflict) {
    throw new Error('workflow_file_conflict')
  }
  await fs.createDir(dirPath)
  await fs.writeFile(filePath, raw)
  return { revision: contentRevision(raw) }
}

export async function deleteWorkflow(
  repo: Repo,
  source: WorkflowFileSource,
  name: string
): Promise<void> {
  assertValidWorkflowName(name)
  const filePath = await resolveWorkflowFilePath(repo, source, name)
  const fs = filesystemForSource(repo, source)
  try {
    await fs.deletePath(filePath)
  } catch (error) {
    if (isENOENT(error)) {
      throw new Error('workflow_file_not_found')
    }
    throw error
  }
}
