import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import { runProcess } from '../../../shared/child-process/run-process'
import type { FileStat } from '../../providers/types'

type FakeEntry = { realPath: string; stat?: FileStat }

/** A remote checkout: requested path -> what the relay's realpath/stat would answer. */
const remoteEntries = new Map<string, FakeEntry>()
const fileStat = (size: number): FileStat => ({ size, type: 'file', mtime: 0 })
const fsProvider = {
  realpath: vi.fn(async (path: string) => {
    const entry = remoteEntries.get(path)
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, realpath '${path}'`)
    }
    return entry.realPath
  }),
  stat: vi.fn(async (path: string) => {
    const entry = [...remoteEntries.values()].find((candidate) => candidate.realPath === path)
    if (!entry?.stat) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`)
    }
    return entry.stat
  }),
  readFile: vi.fn(async (_path: string) => ({ content: 'remote text', isBinary: false }))
}

vi.mock('../../providers/ssh-filesystem-dispatch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSshFilesystemProvider: vi.fn(() => fsProvider)
}))
vi.mock('../../providers/ssh-git-dispatch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireSshGitProvider: vi.fn(() => ({ exec: vi.fn() }))
}))

import { CHECKOUT_FILE_MAX_BYTES } from './workflow-checkout-file-read'
import { getRoleFetchHost, localRoleFetchHost } from './workflow-role-fetch-host'

const REFUSED = 'workflow_checkout_file_refused'

describe('local fetch host reads only regular files inside the checkout', () => {
  let root: string
  let checkout: string
  const read = (relative: string): Promise<string> =>
    localRoleFetchHost.readFile(localRoleFetchHost.joinPath(checkout, relative), checkout)

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-checkout-read-'))
    checkout = join(root, 'repo')
    await mkdir(join(checkout, 'skills', 'plan'), { recursive: true })
    await writeFile(join(checkout, 'skills', 'plan', 'SKILL.md'), 'plan text')
    await writeFile(join(root, 'outside.txt'), 'name: secret\ndescription: host file')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads a normal tracked file', async () => {
    await expect(read('skills/plan/SKILL.md')).resolves.toBe('plan text')
  })

  it('follows a symlink to another regular file inside the checkout', async () => {
    await symlink(join('plan', 'SKILL.md'), join(checkout, 'skills', 'alias.md'))
    await expect(read('skills/alias.md')).resolves.toBe('plan text')
  })

  it('refuses a symlink that resolves outside the checkout, naming the path', async () => {
    await symlink(join(root, 'outside.txt'), join(checkout, 'SKILL.md'))
    await expect(read('SKILL.md')).rejects.toMatchObject({
      code: REFUSED,
      message: expect.stringMatching(/"SKILL\.md".*outside the checkout/)
    })
  })

  it('refuses a symlink into the checkout’s .git directory', async () => {
    await mkdir(join(checkout, '.git'))
    await writeFile(join(checkout, '.git', 'config'), '[remote]')
    await symlink(join('.git', 'config'), join(checkout, 'SKILL.md'))
    await expect(read('SKILL.md')).rejects.toMatchObject({ code: REFUSED })
  })

  it('refuses a symlink to a directory', async () => {
    await symlink('skills', join(checkout, 'SKILL.md'))
    await expect(read('SKILL.md')).rejects.toMatchObject({
      code: REFUSED,
      message: expect.stringContaining('not a regular file')
    })
  })

  it.skipIf(process.platform === 'win32')('refuses a FIFO without blocking on it', async () => {
    const fifo = join(checkout, 'skills', 'plan', 'fifo.md')
    await runProcess({ program: 'mkfifo', args: [fifo] })
    await expect(read('skills/plan/fifo.md')).rejects.toMatchObject({
      code: REFUSED,
      message: expect.stringContaining('not a regular file')
    })
  })

  it('refuses a file over the size cap', async () => {
    await writeFile(join(checkout, 'big.md'), Buffer.alloc(CHECKOUT_FILE_MAX_BYTES + 1, 'a'))
    await expect(read('big.md')).rejects.toMatchObject({
      code: REFUSED,
      message: expect.stringContaining('1 MiB')
    })
    await writeFile(join(checkout, 'edge.md'), Buffer.alloc(CHECKOUT_FILE_MAX_BYTES, 'a'))
    await expect(read('edge.md')).resolves.toHaveLength(CHECKOUT_FILE_MAX_BYTES)
  })

  it('reports a missing file as ENOENT, as before', async () => {
    await expect(read('nope.md')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

const sshRepo: Repo = {
  id: 'repo-1',
  path: '/remote/project',
  displayName: 'Repo',
  badgeColor: '#000',
  addedAt: 0,
  connectionId: 'conn-1'
}

describe('SSH fetch host reads only regular files inside the checkout', () => {
  const checkout = '/remote/tmp/orca-role-import-x/repo'
  const read = (relative: string): Promise<string> => {
    const host = getRoleFetchHost(sshRepo)
    return host.readFile(host.joinPath(checkout, relative), checkout)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    remoteEntries.clear()
    // Why the real root differs: remote temp dirs often sit behind a symlink (/tmp -> /private/tmp).
    remoteEntries.set(checkout, { realPath: '/private/tmp/orca-role-import-x/repo' })
  })

  it('reads a normal file through its real path with a byte cap', async () => {
    remoteEntries.set(`${checkout}/SKILL.md`, {
      realPath: '/private/tmp/orca-role-import-x/repo/SKILL.md',
      stat: fileStat(11)
    })
    await expect(read('SKILL.md')).resolves.toBe('remote text')
    expect(fsProvider.readFile).toHaveBeenCalledWith(
      '/private/tmp/orca-role-import-x/repo/SKILL.md',
      { maxTextBytes: CHECKOUT_FILE_MAX_BYTES, maxBinaryBytes: CHECKOUT_FILE_MAX_BYTES }
    )
  })

  it('follows a symlink to another regular file inside the checkout', async () => {
    remoteEntries.set(`${checkout}/alias.md`, {
      realPath: '/private/tmp/orca-role-import-x/repo/skills/plan/SKILL.md',
      stat: fileStat(11)
    })
    await expect(read('alias.md')).resolves.toBe('remote text')
  })

  it('refuses a symlink that resolves outside the checkout without reading it', async () => {
    remoteEntries.set(`${checkout}/SKILL.md`, { realPath: '/dev/zero', stat: fileStat(0) })
    await expect(read('SKILL.md')).rejects.toMatchObject({
      code: REFUSED,
      message: expect.stringMatching(/"SKILL\.md".*outside the checkout/)
    })
    expect(fsProvider.readFile).not.toHaveBeenCalled()
  })

  it('refuses a sibling path that only shares the checkout’s name prefix', async () => {
    remoteEntries.set(`${checkout}/SKILL.md`, {
      realPath: '/private/tmp/orca-role-import-x/repo-evil/SKILL.md',
      stat: fileStat(1)
    })
    await expect(read('SKILL.md')).rejects.toMatchObject({ code: REFUSED })
  })

  it('refuses a symlink to a directory', async () => {
    remoteEntries.set(`${checkout}/SKILL.md`, {
      realPath: '/private/tmp/orca-role-import-x/repo/skills',
      stat: { size: 64, type: 'directory', mtime: 0 }
    })
    await expect(read('SKILL.md')).rejects.toMatchObject({ code: REFUSED })
    expect(fsProvider.readFile).not.toHaveBeenCalled()
  })

  it('refuses a file over the size cap before transferring it', async () => {
    remoteEntries.set(`${checkout}/big.md`, {
      realPath: '/private/tmp/orca-role-import-x/repo/big.md',
      stat: fileStat(CHECKOUT_FILE_MAX_BYTES + 1)
    })
    await expect(read('big.md')).rejects.toMatchObject({ code: REFUSED })
    expect(fsProvider.readFile).not.toHaveBeenCalled()
  })

  it('refuses content that arrives larger than the cap anyway', async () => {
    remoteEntries.set(`${checkout}/grew.md`, {
      realPath: '/private/tmp/orca-role-import-x/repo/grew.md',
      stat: fileStat(1)
    })
    fsProvider.readFile.mockResolvedValueOnce({
      content: 'a'.repeat(CHECKOUT_FILE_MAX_BYTES + 1),
      isBinary: false
    })
    await expect(read('grew.md')).rejects.toMatchObject({ code: REFUSED })
  })

  it('keeps a missing file an ENOENT-shaped error', async () => {
    await expect(read('nope.md')).rejects.toThrow(/ENOENT/)
  })
})
