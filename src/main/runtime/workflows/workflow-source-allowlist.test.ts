import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { IFilesystemProvider } from '../../providers/types'

vi.mock('../../providers/ssh-filesystem-dispatch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSshFilesystemProvider: vi.fn()
}))

import { getSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import {
  assertSourceAllowed,
  getRepoWorkflowSourceAllowlist,
  isWorkflowSourceAllowed,
  normalizeWorkflowSourceUrl,
  WORKFLOW_SOURCE_NOT_ALLOWED_CODE
} from './workflow-source-allowlist'

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
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only readFile is exercised by getRepoWorkflowSourceAllowlist; the rest of the interface is never reached.
  return overrides as IFilesystemProvider
}

describe('normalizeWorkflowSourceUrl', () => {
  it('trims whitespace, trailing slashes, and a trailing .git suffix', () => {
    expect(normalizeWorkflowSourceUrl('https://github.com/acme/roles')).toBe(
      'https://github.com/acme/roles'
    )
    expect(normalizeWorkflowSourceUrl('  https://github.com/acme/roles/  ')).toBe(
      'https://github.com/acme/roles'
    )
    expect(normalizeWorkflowSourceUrl('https://github.com/acme/roles.git')).toBe(
      'https://github.com/acme/roles'
    )
    expect(normalizeWorkflowSourceUrl('https://github.com/acme/roles.GIT/')).toBe(
      'https://github.com/acme/roles'
    )
  })
})

describe('isWorkflowSourceAllowed / assertSourceAllowed', () => {
  it('permits nothing when the allowlist is empty or missing', () => {
    expect(isWorkflowSourceAllowed('https://github.com/acme/roles', [])).toBe(false)
    expect(() => assertSourceAllowed('https://github.com/acme/roles', [])).toThrow(
      WORKFLOW_SOURCE_NOT_ALLOWED_CODE
    )
  })

  it('allows an exact match after normalisation', () => {
    const allowlist = ['https://github.com/acme/roles.git']
    expect(isWorkflowSourceAllowed('https://github.com/acme/roles/', allowlist)).toBe(true)
    expect(() => assertSourceAllowed('https://github.com/acme/roles/', allowlist)).not.toThrow()
  })

  it('rejects a source not on the allowlist', () => {
    const allowlist = ['https://github.com/acme/roles']
    expect(isWorkflowSourceAllowed('https://github.com/other/roles', allowlist)).toBe(false)
    expect(() => assertSourceAllowed('https://github.com/other/roles', allowlist)).toThrow(
      WORKFLOW_SOURCE_NOT_ALLOWED_CODE
    )
  })
})

describe('getRepoWorkflowSourceAllowlist (local host)', () => {
  let repoPath: string

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'orca-workflow-allowlist-'))
  })

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true })
  })

  it('reads workflows.allowedSources from orca.yaml', async () => {
    await writeFile(
      join(repoPath, 'orca.yaml'),
      ['workflows:', '  allowedSources:', '    - https://github.com/acme/roles'].join('\n')
    )
    const allowlist = await getRepoWorkflowSourceAllowlist(repoFixture({ path: repoPath }))
    expect(allowlist).toEqual(['https://github.com/acme/roles'])
  })

  it('returns an empty allowlist when orca.yaml has no workflows block', async () => {
    await writeFile(join(repoPath, 'orca.yaml'), 'scripts:\n  setup: pnpm install\n')
    const allowlist = await getRepoWorkflowSourceAllowlist(repoFixture({ path: repoPath }))
    expect(allowlist).toEqual([])
  })

  it('returns an empty allowlist when orca.yaml is missing', async () => {
    const allowlist = await getRepoWorkflowSourceAllowlist(repoFixture({ path: repoPath }))
    expect(allowlist).toEqual([])
  })
})

describe('getRepoWorkflowSourceAllowlist (SSH host)', () => {
  const repo = repoFixture({ path: '/remote/repo', connectionId: 'conn-1' })

  it('reads workflows.allowedSources from the remote orca.yaml', async () => {
    vi.mocked(getSshFilesystemProvider).mockReturnValue(
      fakeSshFilesystemProvider({
        readFile: vi.fn().mockResolvedValue({
          content: ['workflows:', '  allowedSources:', '    - https://github.com/acme/roles'].join(
            '\n'
          ),
          isBinary: false
        })
      })
    )

    const allowlist = await getRepoWorkflowSourceAllowlist(repo)
    expect(allowlist).toEqual(['https://github.com/acme/roles'])
  })

  it('throws a clear error instead of falling back to the local host when unreachable', async () => {
    vi.mocked(getSshFilesystemProvider).mockReturnValue(undefined)
    await expect(getRepoWorkflowSourceAllowlist(repo)).rejects.toThrow()
  })

  it('returns an empty allowlist when the remote orca.yaml is missing', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    vi.mocked(getSshFilesystemProvider).mockReturnValue(
      fakeSshFilesystemProvider({ readFile: vi.fn().mockRejectedValue(enoent) })
    )

    const allowlist = await getRepoWorkflowSourceAllowlist(repo)
    expect(allowlist).toEqual([])
  })
})
