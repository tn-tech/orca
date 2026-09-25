import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { IFilesystemProvider } from '../../providers/types'

vi.mock('../../providers/ssh-filesystem-dispatch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSshFilesystemProvider: vi.fn()
}))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  homedir: vi.fn()
}))

import { getSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import {
  deleteWorkflow,
  listWorkflows,
  readWorkflow,
  WorkflowFileValidationError,
  writeWorkflow
} from './workflow-file-store'

function repoFixture(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: '#000',
    addedAt: 0,
    ...overrides
  }
}

/** Test double implementing only the `IFilesystemProvider` methods these cases call. */
function fakeSshFilesystemProvider(overrides: Partial<IFilesystemProvider>): IFilesystemProvider {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only readFile is exercised by the file-store SSH cases; the rest of the interface is never reached.
  return overrides as IFilesystemProvider
}

const MINIMAL_WORKFLOW_YAML = [
  'version: 1',
  'name: test-workflow',
  'workspacePolicy: run-workspace',
  'roles: {}',
  'nodes:',
  '  - { id: start, type: start, title: Start }',
  '  - { id: end, type: end, title: End }',
  'edges:',
  '  - { id: e1, from: start, to: end }',
  'layout:',
  '  start: { x: 0, y: 0 }',
  '  end: { x: 100, y: 0 }'
].join('\n')

function revisionOf(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

describe('workflow-file-store (local host)', () => {
  let repoPath: string
  let homePath: string

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'orca-workflow-store-repo-'))
    homePath = await mkdtemp(join(tmpdir(), 'orca-workflow-store-home-'))
    vi.mocked(homedir).mockReturnValue(homePath)
  })

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true })
    await rm(homePath, { recursive: true, force: true })
  })

  it('creates a workflow file with expectedRevision null and returns its revision', async () => {
    const repo = repoFixture({ path: repoPath })
    const result = await writeWorkflow(repo, 'project', 'feature', MINIMAL_WORKFLOW_YAML, null)
    expect(result.revision).toBe(revisionOf(MINIMAL_WORKFLOW_YAML))
  })

  it('fails workflow_file_conflict creating over an existing file', async () => {
    const repo = repoFixture({ path: repoPath })
    await writeWorkflow(repo, 'project', 'feature', MINIMAL_WORKFLOW_YAML, null)
    await expect(
      writeWorkflow(repo, 'project', 'feature', MINIMAL_WORKFLOW_YAML, null)
    ).rejects.toThrow('workflow_file_conflict')
  })

  it('updates a workflow file when the revision matches', async () => {
    const repo = repoFixture({ path: repoPath })
    const created = await writeWorkflow(repo, 'project', 'feature', MINIMAL_WORKFLOW_YAML, null)
    const updated = MINIMAL_WORKFLOW_YAML.replace('test-workflow', 'test-workflow-renamed')
    const result = await writeWorkflow(repo, 'project', 'feature', updated, created.revision)
    expect(result.revision).toBe(revisionOf(updated))
  })

  it('fails workflow_file_conflict updating with a stale revision', async () => {
    const repo = repoFixture({ path: repoPath })
    await writeWorkflow(repo, 'project', 'feature', MINIMAL_WORKFLOW_YAML, null)
    const updated = MINIMAL_WORKFLOW_YAML.replace('test-workflow', 'test-workflow-renamed')
    await expect(
      writeWorkflow(repo, 'project', 'feature', updated, 'stale-revision')
    ).rejects.toThrow('workflow_file_conflict')
  })

  it('rejects writing content that fails workflow validation', async () => {
    const repo = repoFixture({ path: repoPath })
    await expect(writeWorkflow(repo, 'project', 'feature', 'version: 1\n', null)).rejects.toThrow(
      WorkflowFileValidationError
    )
  })

  it('reads back {definition, raw, revision} for a written workflow', async () => {
    const repo = repoFixture({ path: repoPath })
    await writeWorkflow(repo, 'project', 'feature', MINIMAL_WORKFLOW_YAML, null)
    const result = await readWorkflow(repo, 'project', 'feature')
    expect(result.raw).toBe(MINIMAL_WORKFLOW_YAML)
    expect(result.revision).toBe(revisionOf(MINIMAL_WORKFLOW_YAML))
    expect(result.definition?.name).toBe('test-workflow')
    expect(result.problems).toEqual([])
  })

  it('fails workflow_file_not_found reading a missing workflow', async () => {
    const repo = repoFixture({ path: repoPath })
    await expect(readWorkflow(repo, 'project', 'missing')).rejects.toThrow(
      'workflow_file_not_found'
    )
  })

  it('deletes a workflow file', async () => {
    const repo = repoFixture({ path: repoPath })
    await writeWorkflow(repo, 'project', 'feature', MINIMAL_WORKFLOW_YAML, null)
    await deleteWorkflow(repo, 'project', 'feature')
    await expect(readWorkflow(repo, 'project', 'feature')).rejects.toThrow(
      'workflow_file_not_found'
    )
  })

  it('fails workflow_file_not_found deleting a missing workflow', async () => {
    const repo = repoFixture({ path: repoPath })
    await expect(deleteWorkflow(repo, 'project', 'missing')).rejects.toThrow(
      'workflow_file_not_found'
    )
  })

  it('rejects a workflow name that attempts path traversal', async () => {
    const repo = repoFixture({ path: repoPath })
    await expect(
      writeWorkflow(repo, 'project', '../escape', MINIMAL_WORKFLOW_YAML, null)
    ).rejects.toThrow('workflow_name_invalid')
    await expect(readWorkflow(repo, 'project', 'a/b')).rejects.toThrow('workflow_name_invalid')
  })

  it('writes personal workflows under ~/.orca/workflows regardless of repo host', async () => {
    const repo = repoFixture({ path: repoPath })
    await writeWorkflow(repo, 'personal', 'feature', MINIMAL_WORKFLOW_YAML, null)
    const result = await readWorkflow(repo, 'personal', 'feature')
    expect(result.raw).toBe(MINIMAL_WORKFLOW_YAML)
  })

  it('lists project and personal files, with project winning on a name clash', async () => {
    const repo = repoFixture({ path: repoPath })
    const personalOnly = MINIMAL_WORKFLOW_YAML.replace('test-workflow', 'personal-only')
    const clashPersonal = MINIMAL_WORKFLOW_YAML.replace('test-workflow', 'clash-personal')
    const clashProject = MINIMAL_WORKFLOW_YAML.replace('test-workflow', 'clash-project')

    await writeWorkflow(repo, 'personal', 'personal-only', personalOnly, null)
    await writeWorkflow(repo, 'personal', 'clash', clashPersonal, null)
    await writeWorkflow(repo, 'project', 'clash', clashProject, null)
    await writeWorkflow(repo, 'project', 'project-only', MINIMAL_WORKFLOW_YAML, null)

    const listing = await listWorkflows(repo)
    expect(listing).toEqual([
      { name: 'clash', source: 'project' },
      { name: 'personal-only', source: 'personal' },
      { name: 'project-only', source: 'project' }
    ])
  })

  it('returns an empty list when neither directory exists', async () => {
    const repo = repoFixture({ path: repoPath })
    expect(await listWorkflows(repo)).toEqual([])
  })

  it('honors workflows.directory from orca.yaml for the project source', async () => {
    const repo = repoFixture({ path: repoPath })
    await writeFile(join(repoPath, 'orca.yaml'), 'workflows:\n  directory: custom-workflows\n')
    await writeWorkflow(repo, 'project', 'feature', MINIMAL_WORKFLOW_YAML, null)
    const listing = await listWorkflows(repo)
    expect(listing).toEqual([{ name: 'feature', source: 'project' }])
    await expect(mkdir(join(repoPath, 'custom-workflows'))).rejects.toThrow()
  })
})

describe('workflow-file-store (SSH host)', () => {
  const repo = repoFixture({ path: '/remote/repo', connectionId: 'conn-1' })

  it('throws instead of falling back to the local host when the SSH provider is unreachable', async () => {
    vi.mocked(getSshFilesystemProvider).mockReturnValue(undefined)
    await expect(
      writeWorkflow(repo, 'project', 'feature', MINIMAL_WORKFLOW_YAML, null)
    ).rejects.toThrow()
  })

  it('reads a project workflow through the SSH filesystem provider', async () => {
    vi.mocked(getSshFilesystemProvider).mockReturnValue(
      fakeSshFilesystemProvider({
        readFile: vi.fn().mockResolvedValue({ content: MINIMAL_WORKFLOW_YAML, isBinary: false })
      })
    )

    const result = await readWorkflow(repo, 'project', 'feature')
    expect(result.raw).toBe(MINIMAL_WORKFLOW_YAML)
    expect(result.definition?.name).toBe('test-workflow')
  })
})
