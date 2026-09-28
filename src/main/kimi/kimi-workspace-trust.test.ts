import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { kimiWorkspaceTrustKey } from './kimi-workspace-trust-record'
import { markKimiWorkspaceTrusted } from './kimi-workspace-trust'

// Every expected key below was printed by Kimi Code 2.0.2's own encodeWorkDirKey(
// canonicalWorkspaceRoot(cwd)), lifted verbatim from dist/main.mjs — never recomputed here.
describe('kimiWorkspaceTrustKey', () => {
  it('matches a trust record Kimi itself wrote on a real machine', () => {
    // ~/.kimi-code/workspace-trust/wd_coding-projects_a51ac27fb28b, written by "Trust this folder".
    expect(kimiWorkspaceTrustKey('/Users/rnabulsi/coding-projects')).toBe(
      'wd_coding-projects_a51ac27fb28b'
    )
  })

  it.each([
    ['C:\\', 'wd_c_826c0d7d3c42'],
    ['D:/', 'wd_d_394e0f7e2f80'],
    ['\\\\server\\Share\\Repo', 'wd_repo_ac1eb3e234ec'],
    ['/', 'wd_workspace_e3b0c44298fc']
  ])('hashes root-shaped cwd %s the way Kimi does', (root, key) => {
    expect(kimiWorkspaceTrustKey(root)).toBe(key)
  })

  it('slugs the last segment and hashes the POSIX root', () => {
    expect(kimiWorkspaceTrustKey('/home/dev/projects/My App')).toBe('wd_my-app_c06993919e4d')
  })

  it('ignores trailing slashes', () => {
    expect(kimiWorkspaceTrustKey('/home/dev/wt/')).toBe('wd_wt_7065904a5005')
  })

  it('lowercases and forward-slashes Windows-shaped roots before hashing', () => {
    expect(kimiWorkspaceTrustKey('C:\\Users\\Dev\\src\\App')).toBe('wd_app_e62477a20fe8')
  })
})

describe('markKimiWorkspaceTrusted', () => {
  let kimiHome = ''
  let workspace = ''
  let previousKimiHome: string | undefined

  beforeEach(() => {
    previousKimiHome = process.env.KIMI_CODE_HOME
    kimiHome = mkdtempSync(join(tmpdir(), 'orca-kimi-trust-home-'))
    workspace = mkdtempSync(join(tmpdir(), 'orca-kimi-trust-ws-'))
    process.env.KIMI_CODE_HOME = kimiHome
  })

  afterEach(() => {
    if (previousKimiHome === undefined) {
      delete process.env.KIMI_CODE_HOME
    } else {
      process.env.KIMI_CODE_HOME = previousKimiHome
    }
    rmSync(kimiHome, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  it('writes the trust record Kimi reads at startup, keyed by the realpath', async () => {
    await markKimiWorkspaceTrusted(workspace)

    const { realpathSync } = await import('node:fs')
    const root = realpathSync.native(workspace)
    const recordPath = join(kimiHome, 'workspace-trust', kimiWorkspaceTrustKey(root))
    const record: unknown = JSON.parse(readFileSync(recordPath, 'utf-8'))
    expect(record).toEqual({ root, trustedAt: expect.any(Number) })
  })

  it('leaves an existing trust record untouched', async () => {
    const { realpathSync } = await import('node:fs')
    const root = realpathSync.native(workspace)
    const trustDir = join(kimiHome, 'workspace-trust')
    mkdirSync(trustDir, { recursive: true })
    const recordPath = join(trustDir, kimiWorkspaceTrustKey(root))
    writeFileSync(recordPath, '{"root":"x","trustedAt":1}')

    await markKimiWorkspaceTrusted(workspace)

    expect(readFileSync(recordPath, 'utf-8')).toBe('{"root":"x","trustedAt":1}')
  })

  it('keys a POSIX workspace by its realpath only, like getcwd()', async () => {
    const { realpathSync, symlinkSync } = await import('node:fs')
    const link = join(workspace, 'link')
    const target = join(workspace, 'target')
    mkdirSync(target)
    symlinkSync(target, link)

    await markKimiWorkspaceTrusted(link, { platform: 'linux' })

    const trustDir = join(kimiHome, 'workspace-trust')
    expect(existsSync(join(trustDir, kimiWorkspaceTrustKey(realpathSync.native(link))))).toBe(true)
    expect(existsSync(join(trustDir, kimiWorkspaceTrustKey(link)))).toBe(false)
  })

  it('keys a Windows workspace by the path as launched and by its realpath', async () => {
    // Why: GetCurrentDirectory keeps junction/subst/mapped-drive paths, which realpath rewrites.
    const { realpathSync, symlinkSync } = await import('node:fs')
    const link = join(workspace, 'junction')
    const target = join(workspace, 'target')
    mkdirSync(target)
    symlinkSync(target, link)

    await markKimiWorkspaceTrusted(link, { platform: 'win32' })

    const trustDir = join(kimiHome, 'workspace-trust')
    const asLaunched: unknown = JSON.parse(
      readFileSync(join(trustDir, kimiWorkspaceTrustKey(link)), 'utf-8')
    )
    expect(asLaunched).toEqual({ root: link, trustedAt: expect.any(Number) })
    const resolved = realpathSync.native(link)
    const asResolved: unknown = JSON.parse(
      readFileSync(join(trustDir, kimiWorkspaceTrustKey(resolved)), 'utf-8')
    )
    expect(asResolved).toEqual({ root: resolved, trustedAt: expect.any(Number) })
  })

  it('writes WSL workspaces into the distro home, keyed by the Linux path Kimi sees', async () => {
    const distroHome = mkdtempSync(join(tmpdir(), 'orca-kimi-trust-wsl-'))
    try {
      await markKimiWorkspaceTrusted('\\\\wsl.localhost\\Ubuntu\\home\\dev\\wt', {
        platform: 'win32',
        resolveWslHome: async (distro) => (distro === 'Ubuntu' ? distroHome : null)
      })

      const recordPath = join(distroHome, '.kimi-code', 'workspace-trust', 'wd_wt_7065904a5005')
      const record: unknown = JSON.parse(readFileSync(recordPath, 'utf-8'))
      expect(record).toEqual({ root: '/home/dev/wt', trustedAt: expect.any(Number) })
      expect(existsSync(join(kimiHome, 'workspace-trust'))).toBe(false)
    } finally {
      rmSync(distroHome, { recursive: true, force: true })
    }
  })

  it('skips a WSL workspace whose distro home cannot be resolved', async () => {
    await markKimiWorkspaceTrusted('\\\\wsl.localhost\\Ubuntu\\home\\dev\\wt', {
      platform: 'win32',
      resolveWslHome: async () => null
    })

    expect(existsSync(join(kimiHome, 'workspace-trust'))).toBe(false)
  })
})
