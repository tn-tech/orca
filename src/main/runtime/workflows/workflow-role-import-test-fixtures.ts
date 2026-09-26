import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { RoleFetchHost } from './workflow-role-fetch-host'

export const ROLE_SOURCE = 'https://github.com/acme/roles'
export const SHA_1 = 'a'.repeat(40)
export const SHA_2 = 'b'.repeat(40)
export const IMPORT_NOW = new Date('2026-09-27T10:00:00.000Z')

export function roleYaml(systemPrompt: string, skillLocation = ROLE_SOURCE): string {
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

export function workflowWithRoles(roles: Workflow['roles'] = {}): Workflow {
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

export type FakeRoleFetchHost = RoleFetchHost & {
  cloneCalls: { source: string; version: string | undefined }[]
  gitCalls: string[][]
}

/** Serves `files` as the upstream repository at `sha`, inside temp dirs under `root`. */
export function fakeRoleFetchHost(
  root: string,
  upstream: { files: Record<string, string>; sha: string; cloneError?: Error }
): FakeRoleFetchHost {
  const cloneCalls: FakeRoleFetchHost['cloneCalls'] = []
  const gitCalls: string[][] = []
  return {
    cloneCalls,
    gitCalls,
    joinPath: (dir, relative) => join(dir, ...relative.split('/')),
    createTempDir: () => mkdtemp(join(root, 'import-')),
    async clone(source, version, cwd, dirName) {
      cloneCalls.push({ source, version })
      if (upstream.cloneError) {
        throw upstream.cloneError
      }
      const destination = join(cwd, dirName)
      for (const [relative, content] of Object.entries(upstream.files)) {
        await mkdir(join(destination, relative, '..'), { recursive: true })
        await writeFile(join(destination, relative), content)
      }
    },
    async runGit(args) {
      gitCalls.push(args)
      return `${upstream.sha}\n`
    },
    readFile: (path) => readFile(path, 'utf-8'),
    removeDir: (path) => rm(path, { recursive: true, force: true })
  }
}
