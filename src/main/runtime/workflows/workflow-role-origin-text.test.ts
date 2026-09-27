import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitExecFileAsync } from '../../git/runner'
import { localRoleFetchHost } from './workflow-role-fetch-host'
import { fetchOriginRoleText } from './workflow-role-origin-text'
import { originRole } from './workflow-role-proposal-test-fixtures'

const IMPORTED = "name: Developer\nagent: codex\nsystemPrompt: 'Implement it.'\nskills: []\n"

describe('fetchOriginRoleText', () => {
  let dir: string
  let source: string

  const git = async (args: string[]) => (await gitExecFileAsync(args, { cwd: dir })).stdout.trim()

  async function commit(files: Record<string, string>): Promise<string> {
    for (const [path, text] of Object.entries(files)) {
      await writeFile(join(dir, path), text)
    }
    await git(['add', '.'])
    await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'c'])
    return git(['rev-parse', 'HEAD'])
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'role-origin-text-'))
    await mkdir(join(dir, 'roles'))
    await git(['init', '--quiet'])
    source = pathToFileURL(dir).href
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  const deps = (allowlist: string[]) => ({ getHost: () => localRoleFetchHost, allowlist })

  it('checks out the imported commit when the role changed upstream since', async () => {
    const version = await commit({ 'roles/developer.role.yaml': IMPORTED })
    const moved = IMPORTED.replace('Implement it.', 'Implement it upstream.')
    const tip = await commit({ 'roles/developer.role.yaml': moved })
    const origin = originRole(IMPORTED, source, version).origin
    if (!origin) {
      throw new Error('fixture role has no origin')
    }
    const fetched = await fetchOriginRoleText('developer', origin, deps([source]))
    expect(fetched).toEqual({ text: IMPORTED, version })
    expect(version).not.toBe(tip)
  })

  it('uses the tip, and names it, when only other files moved upstream', async () => {
    const version = await commit({ 'roles/developer.role.yaml': IMPORTED })
    const tip = await commit({ 'README.md': 'roles\n' })
    const origin = originRole(IMPORTED, source, version).origin
    if (!origin) {
      throw new Error('fixture role has no origin')
    }
    const fetched = await fetchOriginRoleText('developer', origin, deps([source]))
    expect(fetched).toEqual({ text: IMPORTED, version: tip })
  })

  it('falls back without cloning when the source is no longer allowlisted', async () => {
    const version = await commit({ 'roles/developer.role.yaml': IMPORTED })
    const origin = originRole(IMPORTED, source, version).origin
    if (!origin) {
      throw new Error('fixture role has no origin')
    }
    const getHost = vi.fn(() => localRoleFetchHost)
    await expect(
      fetchOriginRoleText('developer', origin, { getHost, allowlist: ['https://other.test/r'] })
    ).resolves.toBeUndefined()
    expect(getHost).not.toHaveBeenCalled()
  })
})
