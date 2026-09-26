import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Workflow } from '../../../shared/workflows/workflow-definition-types'
import { gitExecFileAsync } from '../../git/runner'
import { localRoleFetchHost, type RoleFetchHost } from './workflow-role-fetch-host'
import {
  fetchRoleForImport,
  RoleSourceNotAllowedError,
  withImportedRole
} from './workflow-role-import'

const SOURCE = 'https://github.com/acme/roles'
const SHA_1 = 'a'.repeat(40)
const SHA_2 = 'b'.repeat(40)
const NOW = new Date('2026-09-27T10:00:00.000Z')

function roleYaml(systemPrompt: string, skillLocation = SOURCE): string {
  return [
    'name: Engagement Manager',
    'agent: claude',
    'model: opus',
    `systemPrompt: ${JSON.stringify(systemPrompt)}`,
    'skills:',
    '  - name: deck-review',
    '    source: { kind: plugin, plugin: consulting }',
    '  - name: model-check',
    `    source: { kind: repository, location: "${skillLocation}" }`
  ].join('\n')
}

function workflowWithRoles(roles: Workflow['roles'] = {}): Workflow {
  return {
    version: 1,
    name: 'demo',
    workspacePolicy: 'run-workspace',
    roles,
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
    layout: {}
  }
}

/** Serves `files` as the upstream repository at `sha`; records every git call and temp dir. */
function fakeHost(
  root: string,
  upstream: { files: Record<string, string>; sha: string }
): RoleFetchHost & { gitCalls: string[][]; tempDirs: string[] } {
  const gitCalls: string[][] = []
  const tempDirs: string[] = []
  return {
    gitCalls,
    tempDirs,
    joinPath: (dir, relative) => join(dir, ...relative.split('/')),
    async createTempDir() {
      const dir = await mkdtemp(join(root, 'import-'))
      tempDirs.push(dir)
      return dir
    },
    async runGit(args, cwd) {
      gitCalls.push(args)
      if (args[0] === 'clone') {
        const destination = join(cwd, args.at(-1) ?? '')
        for (const [relative, content] of Object.entries(upstream.files)) {
          await mkdir(join(destination, relative, '..'), { recursive: true })
          await writeFile(join(destination, relative), content)
        }
        return ''
      }
      return `${upstream.sha}\n`
    },
    readFile: (path) => readFile(path, 'utf-8'),
    removeDir: (path) => rm(path, { recursive: true, force: true })
  }
}

describe('workflow role import', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-role-import-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function importInto(
    definition: Workflow,
    upstream: { files: Record<string, string>; sha: string },
    request: { version?: string } = {}
  ): Promise<ReturnType<typeof withImportedRole> & { host: ReturnType<typeof fakeHost> }> {
    const host = fakeHost(root, upstream)
    const fetched = await fetchRoleForImport(
      { source: SOURCE, roleName: 'manager', ...request },
      { host, allowlist: [SOURCE], now: NOW }
    )
    return { ...withImportedRole(definition, fetched), host }
  }

  it('copies the role into the definition with its origin and cleans up the checkout', async () => {
    const { definition, role, host } = await importInto(workflowWithRoles(), {
      files: { 'roles/manager.role.yaml': roleYaml('Run the engagement.') },
      sha: SHA_1
    })

    const expected: Role = {
      id: 'manager',
      name: 'Engagement Manager',
      agent: 'claude',
      model: 'opus',
      systemPrompt: 'Run the engagement.',
      skills: [
        { name: 'deck-review', source: { kind: 'plugin', plugin: 'consulting' }, required: true },
        { name: 'model-check', source: { kind: 'repository', location: SOURCE }, required: true }
      ],
      origin: {
        source: SOURCE,
        version: SHA_1,
        importedAt: NOW.toISOString(),
        localModified: false
      }
    }
    expect(role).toEqual(expected)
    expect(definition.roles.manager).toEqual(expected)
    expect(host.gitCalls[0]).toEqual(['clone', '--quiet', '--depth', '1', '--', SOURCE, 'repo'])
    expect(await readdir(root)).toEqual([])
  })

  it('clones the requested version and records the resolved commit', async () => {
    const { role, host } = await importInto(
      workflowWithRoles(),
      { files: { 'roles/manager.role.yaml': roleYaml('v2') }, sha: SHA_2 },
      { version: 'v2.0' }
    )
    expect(host.gitCalls[0]).toEqual([
      'clone',
      '--quiet',
      '--depth',
      '1',
      '--branch',
      'v2.0',
      '--',
      SOURCE,
      'repo'
    ])
    expect(role.origin?.version).toBe(SHA_2)
  })

  it('re-import updates an unmodified role to the new upstream version', async () => {
    const first = await importInto(workflowWithRoles(), {
      files: { 'roles/manager.role.yaml': roleYaml('Old prompt.') },
      sha: SHA_1
    })
    const second = await importInto(first.definition, {
      files: { 'roles/manager.role.yaml': roleYaml('New prompt.') },
      sha: SHA_2
    })
    expect(second.role.systemPrompt).toBe('New prompt.')
    expect(second.role.origin).toMatchObject({ version: SHA_2, localModified: false })
  })

  it('re-import keeps a locally edited role and flags localModified when it differs', async () => {
    const first = await importInto(workflowWithRoles(), {
      files: { 'roles/manager.role.yaml': roleYaml('Upstream prompt.') },
      sha: SHA_1
    })
    const edited = workflowWithRoles({
      manager: { ...first.role, systemPrompt: 'My local prompt.' }
    })

    // Same upstream commit: the difference can only be a local edit.
    const second = await importInto(edited, {
      files: { 'roles/manager.role.yaml': roleYaml('Upstream prompt.') },
      sha: SHA_1
    })
    expect(second.role.systemPrompt).toBe('My local prompt.')
    expect(second.role.origin).toMatchObject({ version: SHA_1, localModified: true })

    // Upstream moved on: the local edit is still kept and still flagged, against the new version.
    const third = await importInto(second.definition, {
      files: { 'roles/manager.role.yaml': roleYaml('Upstream v2.') },
      sha: SHA_2
    })
    expect(third.role.systemPrompt).toBe('My local prompt.')
    expect(third.role.origin).toMatchObject({ version: SHA_2, localModified: true })
  })

  it('re-import clears localModified once the local copy matches upstream again', async () => {
    const first = await importInto(workflowWithRoles(), {
      files: { 'roles/manager.role.yaml': roleYaml('Same.') },
      sha: SHA_1
    })
    const flagged = workflowWithRoles({
      manager: { ...first.role, origin: { ...first.role.origin!, localModified: true } }
    })
    const second = await importInto(flagged, {
      files: { 'roles/manager.role.yaml': roleYaml('Same.') },
      sha: SHA_1
    })
    expect(second.role.origin?.localModified).toBe(false)
  })

  it('refuses a non-allowlisted role source before fetching anything', async () => {
    const host = fakeHost(root, { files: {}, sha: SHA_1 })
    const attempt = fetchRoleForImport(
      { source: 'https://github.com/evil/roles', roleName: 'manager' },
      { host, allowlist: [SOURCE], now: NOW }
    )
    await expect(attempt).rejects.toBeInstanceOf(RoleSourceNotAllowedError)
    await expect(attempt).rejects.toMatchObject({ source: 'https://github.com/evil/roles' })
    expect(host.gitCalls).toEqual([])
  })

  it('refuses a role whose repository skill source is not allowlisted', async () => {
    const host = fakeHost(root, {
      files: { 'roles/manager.role.yaml': roleYaml('x', 'https://github.com/evil/skills') },
      sha: SHA_1
    })
    const attempt = fetchRoleForImport(
      { source: SOURCE, roleName: 'manager' },
      { host, allowlist: [SOURCE], now: NOW }
    )
    await expect(attempt).rejects.toMatchObject({ source: 'https://github.com/evil/skills' })
    expect(await readdir(root)).toEqual([])
  })

  it('rejects role names that could escape the roles directory', async () => {
    const host = fakeHost(root, { files: {}, sha: SHA_1 })
    for (const roleName of ['../secret', 'a/b', 'a\\b', '.hidden', '-x']) {
      await expect(
        fetchRoleForImport({ source: SOURCE, roleName }, { host, allowlist: [SOURCE], now: NOW })
      ).rejects.toThrow('workflow_role_name_invalid')
    }
    expect(host.gitCalls).toEqual([])
  })

  it('reports a missing role file and an invalid one distinctly', async () => {
    const missing = fakeHost(root, { files: {}, sha: SHA_1 })
    await expect(
      fetchRoleForImport(
        { source: SOURCE, roleName: 'manager' },
        { host: missing, allowlist: [SOURCE], now: NOW }
      )
    ).rejects.toThrow('workflow_role_not_found')

    const invalid = fakeHost(root, {
      files: { 'roles/manager.role.yaml': 'name: Only a name\n' },
      sha: SHA_1
    })
    await expect(
      fetchRoleForImport(
        { source: SOURCE, roleName: 'manager' },
        { host: invalid, allowlist: [SOURCE], now: NOW }
      )
    ).rejects.toMatchObject({ code: 'workflow_role_invalid' })
    expect(await readdir(root)).toEqual([])
  })

  it('fetches from a real git repository with the local host', async () => {
    const upstreamDir = join(root, 'upstream')
    await mkdir(join(upstreamDir, 'roles'), { recursive: true })
    await writeFile(join(upstreamDir, 'roles', 'manager.role.yaml'), roleYaml('Real.', 'unused'))
    const git = (args: string[]): Promise<{ stdout: string }> =>
      gitExecFileAsync(args, { cwd: upstreamDir })
    await git(['init', '--quiet'])
    await git(['add', '.'])
    await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'roles'])
    const sha = (await git(['rev-parse', 'HEAD'])).stdout.trim()
    const source = pathToFileURL(upstreamDir).href

    const fetched = await fetchRoleForImport(
      { source, roleName: 'manager' },
      { host: localRoleFetchHost, allowlist: [source, 'unused'], now: NOW }
    )
    expect(fetched.content.systemPrompt).toBe('Real.')
    expect(fetched.version).toBe(sha)
  })
})
