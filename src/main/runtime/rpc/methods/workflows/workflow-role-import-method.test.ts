import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../../shared/repo-types'
import { gitExecFileAsync } from '../../../../git/runner'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { readWorkflow } from '../../../workflows/workflow-file-store'
import type { RpcRequest } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { WORKFLOW_DEFINITION_METHODS } from './definitions'

const ROLE_YAML = [
  'name: Reviewer',
  'agent: claude',
  'systemPrompt: Review the model.',
  'skills:',
  '  - name: deck-review',
  '    source: { kind: plugin, plugin: consulting }'
].join('\n')

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('workflow.importRole', () => {
  let root: string
  let repo: Repo
  let roleSource: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-import-role-rpc-'))
    const repoPath = join(root, 'project')
    const upstream = join(root, 'roles-repo')
    await mkdir(repoPath)
    await mkdir(join(upstream, 'roles'), { recursive: true })
    await writeFile(join(upstream, 'roles', 'reviewer.role.yaml'), ROLE_YAML)
    const git = (args: string[]): Promise<unknown> => gitExecFileAsync(args, { cwd: upstream })
    await git(['init', '--quiet'])
    await git(['add', '.'])
    await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'roles'])
    roleSource = pathToFileURL(upstream).href
    repo = { id: 'repo-1', path: repoPath, displayName: 'Repo', badgeColor: '#000', addedAt: 0 }
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function dispatcher(): RpcDispatcher {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handlers under test only call showRepo; the rest of OrcaRuntimeService's surface is never reached.
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      showRepo: vi.fn().mockResolvedValue(repo)
    } as unknown as OrcaRuntimeService
    return new RpcDispatcher({ runtime, methods: WORKFLOW_DEFINITION_METHODS })
  }

  async function allowlist(sources: string[]): Promise<void> {
    const entries = sources.map((source) => `    - "${source}"`).join('\n')
    await writeFile(join(repo.path, 'orca.yaml'), `workflows:\n  allowedSources:\n${entries}\n`)
  }

  it('refuses a source missing from the allowlist, naming it and the allowlist file', async () => {
    const response = await dispatcher().dispatch(
      makeRequest('workflow.importRole', {
        repo: 'path:unused',
        source: roleSource,
        roleName: 'reviewer'
      })
    )
    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'workflow_source_not_allowed',
        message: expect.stringContaining(roleSource),
        data: { source: roleSource, allowlistPath: join(repo.path, 'orca.yaml') }
      }
    })
  })

  it('returns the imported role with its origin when no workflow is named', async () => {
    await allowlist([roleSource])
    const response = await dispatcher().dispatch(
      makeRequest('workflow.importRole', {
        repo: 'path:unused',
        source: roleSource,
        roleName: 'reviewer'
      })
    )
    expect(response).toMatchObject({
      ok: true,
      result: {
        role: {
          id: 'reviewer',
          name: 'Reviewer',
          origin: { source: roleSource, version: expect.any(String), localModified: false }
        }
      }
    })
    expect(response.ok && response.result).not.toHaveProperty('revision')
  })

  it('copies the role into the named workflow file and bumps its revision', async () => {
    await allowlist([roleSource])
    const d = dispatcher()
    await d.dispatch(
      makeRequest('workflow.write', {
        repo: 'path:unused',
        name: 'demo',
        definition: {
          version: 1,
          name: 'demo',
          workspacePolicy: 'run-workspace',
          roles: {},
          nodes: [
            { id: 'start', type: 'start', title: 'Start' },
            { id: 'end', type: 'end', title: 'End' }
          ],
          edges: [{ id: 'e1', from: 'start', to: 'end' }],
          layout: {}
        }
      })
    )
    const before = (await readWorkflow(repo, 'project', 'demo')).revision

    const response = await d.dispatch(
      makeRequest('workflow.importRole', {
        repo: 'path:unused',
        source: roleSource,
        roleName: 'reviewer',
        workflow: 'demo',
        expectedRevision: before
      })
    )
    const saved = await readWorkflow(repo, 'project', 'demo')
    expect(saved.revision).not.toBe(before)
    expect(response).toMatchObject({ ok: true, result: { revision: saved.revision } })
    expect(saved.definition?.roles.reviewer).toMatchObject({
      systemPrompt: 'Review the model.',
      origin: { source: roleSource, localModified: false }
    })
  })
})
