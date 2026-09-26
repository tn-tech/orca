import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import { validateGitExecArgs } from '../../../relay/git-exec-validator'

const gitExec = vi.fn(async (args: string[], _cwd: string) => {
  // The relay rejects anything outside its allowlist; run the real validator on what we send.
  validateGitExecArgs(args)
  return { stdout: args[0] === 'rev-parse' ? 'abc\n' : '', stderr: '' }
})
const fsProvider = {
  getTempDir: vi.fn(async () => '/remote/tmp'),
  createDir: vi.fn(async () => {}),
  readFile: vi.fn(async () => ({ content: 'x', isBinary: false })),
  deletePath: vi.fn(async () => {})
}

vi.mock('../../providers/ssh-filesystem-dispatch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSshFilesystemProvider: vi.fn(() => fsProvider)
}))
vi.mock('../../providers/ssh-git-dispatch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireSshGitProvider: vi.fn(() => ({ exec: gitExec }))
}))

import { getRoleFetchHost } from './workflow-role-fetch-host'

const sshRepo: Repo = {
  id: 'repo-1',
  path: '/remote/project',
  displayName: 'Repo',
  badgeColor: '#000',
  addedAt: 0,
  connectionId: 'conn-1'
}

describe('SSH role fetch host', () => {
  it('sends only clone and rev-parse argv the relay git.exec validator accepts', async () => {
    const host = getRoleFetchHost(sshRepo)
    const tempDir = await host.createTempDir()
    expect(tempDir).toMatch(/^\/remote\/tmp\/orca-role-import-/)
    await host.clone('https://github.com/acme/roles', undefined, tempDir, 'repo')
    await expect(host.runGit(['rev-parse', 'HEAD'], `${tempDir}/repo`)).resolves.toBe('abc\n')
    expect(gitExec.mock.calls.map(([args]) => args)).toEqual([
      ['clone', '--', 'https://github.com/acme/roles', 'repo'],
      ['rev-parse', 'HEAD']
    ])
    await host.removeDir(tempDir)
    expect(fsProvider.deletePath).toHaveBeenCalledWith(tempDir, true)
  })

  it('refuses a pinned version, which the relay cannot fetch, without calling git', async () => {
    gitExec.mockClear()
    const host = getRoleFetchHost(sshRepo)
    await expect(
      host.clone('https://github.com/acme/roles', 'v1', '/remote/tmp/x', 'repo')
    ).rejects.toMatchObject({ code: 'workflow_role_version_unsupported' })
    expect(gitExec).not.toHaveBeenCalled()
  })
})
