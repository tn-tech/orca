import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Role } from '../../../shared/workflows/workflow-definition-types'
import { gitExecFileAsync } from '../../git/runner'
import { localRoleFetchHost, type RoleFetchHost } from './workflow-role-fetch-host'
import { fetchRoleForImport, RoleSourceNotAllowedError } from './workflow-role-import'
import { roleContentHash, withImportedRole } from './workflow-role-import-merge'
import {
  fakeRoleFetchHost,
  IMPORT_NOW,
  ROLE_SOURCE,
  roleYaml,
  SHA_1,
  SHA_2,
  workflowWithRoles
} from './workflow-role-import-test-fixtures'

function deps(host: RoleFetchHost, allowlist: string[] = [ROLE_SOURCE]) {
  return { getHost: () => host, allowlist, now: IMPORT_NOW }
}

describe('workflow role import: fetch', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-role-import-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('copies the role into the definition with its origin and cleans up the checkout', async () => {
    const host = fakeRoleFetchHost(root, {
      files: { 'roles/manager.role.yaml': roleYaml('Run the engagement.') },
      sha: SHA_1
    })
    const fetched = await fetchRoleForImport(
      { source: ROLE_SOURCE, roleName: 'manager' },
      deps(host)
    )
    const { definition, role } = withImportedRole(workflowWithRoles(), fetched)

    const content = {
      name: 'Engagement Manager',
      agent: 'claude',
      model: 'opus',
      systemPrompt: 'Run the engagement.',
      skills: [
        {
          name: 'deck-review',
          source: { kind: 'plugin' as const, plugin: 'consulting' },
          required: true
        },
        {
          name: 'model-check',
          source: { kind: 'repository' as const, location: ROLE_SOURCE },
          required: true
        }
      ]
    }
    const expected: Role = {
      id: 'manager',
      ...content,
      origin: {
        source: ROLE_SOURCE,
        version: SHA_1,
        importedAt: IMPORT_NOW.toISOString(),
        localModified: false,
        contentHash: roleContentHash(content)
      }
    }
    expect(role).toEqual(expected)
    expect(definition.roles.manager).toEqual(expected)
    expect(host.cloneCalls).toEqual([{ source: ROLE_SOURCE, version: undefined }])
    expect(host.gitCalls).toEqual([['rev-parse', 'HEAD']])
    expect(await readdir(root)).toEqual([])
  })

  it('clones the matching allowlist entry and passes the requested version through', async () => {
    const host = fakeRoleFetchHost(root, {
      files: { 'roles/manager.role.yaml': roleYaml('v2') },
      sha: SHA_2
    })
    const fetched = await fetchRoleForImport(
      { source: `${ROLE_SOURCE}.git/`, roleName: 'manager', version: 'v2.0' },
      deps(host)
    )
    expect(host.cloneCalls).toEqual([{ source: ROLE_SOURCE, version: 'v2.0' }])
    expect(fetched).toMatchObject({ source: ROLE_SOURCE, version: SHA_2 })
  })

  it('refuses a non-allowlisted role source before resolving the host', async () => {
    let resolved = false
    const attempt = fetchRoleForImport(
      { source: 'https://github.com/evil/roles', roleName: 'manager' },
      {
        getHost: () => {
          resolved = true
          throw new Error('host unavailable')
        },
        allowlist: [ROLE_SOURCE],
        now: IMPORT_NOW
      }
    )
    await expect(attempt).rejects.toBeInstanceOf(RoleSourceNotAllowedError)
    await expect(attempt).rejects.toMatchObject({ source: 'https://github.com/evil/roles' })
    expect(resolved).toBe(false)
  })

  it('refuses a role whose repository skill source is not allowlisted', async () => {
    const host = fakeRoleFetchHost(root, {
      files: { 'roles/manager.role.yaml': roleYaml('x', 'https://github.com/evil/skills') },
      sha: SHA_1
    })
    await expect(
      fetchRoleForImport({ source: ROLE_SOURCE, roleName: 'manager' }, deps(host))
    ).rejects.toMatchObject({ source: 'https://github.com/evil/skills' })
    expect(await readdir(root)).toEqual([])
  })

  it('rejects role names that could escape the roles directory', async () => {
    const host = fakeRoleFetchHost(root, { files: {}, sha: SHA_1 })
    for (const roleName of ['../secret', 'a/b', 'a\\b', '.hidden', '-x']) {
      await expect(
        fetchRoleForImport({ source: ROLE_SOURCE, roleName }, deps(host))
      ).rejects.toThrow('workflow_role_name_invalid')
    }
    expect(host.cloneCalls).toEqual([])
  })

  it('reports a missing role file and an invalid one distinctly', async () => {
    const missing = fakeRoleFetchHost(root, { files: {}, sha: SHA_1 })
    await expect(
      fetchRoleForImport({ source: ROLE_SOURCE, roleName: 'manager' }, deps(missing))
    ).rejects.toThrow('workflow_role_not_found')

    const invalid = fakeRoleFetchHost(root, {
      files: { 'roles/manager.role.yaml': 'name: Only a name\n' },
      sha: SHA_1
    })
    await expect(
      fetchRoleForImport({ source: ROLE_SOURCE, roleName: 'manager' }, deps(invalid))
    ).rejects.toMatchObject({ code: 'workflow_role_invalid' })
    expect(await readdir(root)).toEqual([])
  })

  describe('with a real git repository and the local host', () => {
    let source: string
    let sha: string

    beforeEach(async () => {
      const upstreamDir = join(root, 'upstream')
      await mkdir(join(upstreamDir, 'roles'), { recursive: true })
      await writeFile(join(upstreamDir, 'roles', 'manager.role.yaml'), roleYaml('Real.', 'unused'))
      const git = (args: string[]): Promise<{ stdout: string }> =>
        gitExecFileAsync(args, { cwd: upstreamDir })
      await git(['init', '--quiet'])
      await git(['add', '.'])
      await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'roles'])
      await git(['tag', 'v1'])
      sha = (await git(['rev-parse', 'HEAD'])).stdout.trim()
      source = pathToFileURL(upstreamDir).href
    })

    it('fetches the default branch and a named tag', async () => {
      for (const version of [undefined, 'v1']) {
        const fetched = await fetchRoleForImport(
          { source, roleName: 'manager', version },
          deps(localRoleFetchHost, [source, 'unused'])
        )
        expect(fetched.content.systemPrompt).toBe('Real.')
        expect(fetched.version).toBe(sha)
      }
    })

    it('maps an unknown version to a clear error', async () => {
      await expect(
        fetchRoleForImport(
          { source, roleName: 'manager', version: 'no-such-tag' },
          deps(localRoleFetchHost, [source, 'unused'])
        )
      ).rejects.toMatchObject({
        code: 'workflow_role_version_not_found',
        message: expect.stringContaining('"no-such-tag" is not a branch or tag')
      })
    })
  })
})
