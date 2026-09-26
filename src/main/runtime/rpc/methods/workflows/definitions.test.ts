import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcRequest } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { Repo } from '../../../../../shared/repo-types'
import { writeWorkflow } from '../../../workflows/workflow-file-store'
import { WORKFLOW_DEFINITION_METHODS } from './definitions'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

// Written straight to disk (bypassing workflow.write, which refuses this) to exercise
// workflow.duplicate's own allowlist check on the file it reads.
const NON_ALLOWLISTED_SOURCE_WORKFLOW_YAML = [
  'version: 1',
  'name: tainted',
  'workspacePolicy: run-workspace',
  'roles:',
  '  dev:',
  '    name: Developer',
  '    agent: claude',
  '    systemPrompt: Build it.',
  '    skills:',
  '      - name: a-skill',
  '        source: { kind: repository, location: "https://example.com/not-allowlisted" }',
  '        required: true',
  'nodes:',
  '  - { id: start, type: start, title: Start }',
  '  - id: work',
  '    type: agent',
  '    title: Work',
  '    roleId: dev',
  '    prompt: Go',
  '    workspace: run',
  '    resultContract: { type: object }',
  '    artifacts: []',
  '    question: { timeoutMs: 1000, escalationGraceMs: 1000 }',
  '  - { id: end, type: end, title: End }',
  'edges:',
  '  - { id: e1, from: start, to: work }',
  '  - { id: e2, from: work, to: end }',
  'layout: {}'
].join('\n')

function minimalWorkflow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'demo',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
    layout: {},
    ...overrides
  }
}

function agentWorkflowWithSkillSource(source: Record<string, unknown>): Record<string, unknown> {
  return minimalWorkflow({
    roles: {
      dev: {
        id: 'dev',
        name: 'Developer',
        agent: 'claude',
        systemPrompt: 'Build it.',
        skills: [{ name: 'a-skill', source, required: true }]
      }
    },
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      {
        id: 'work',
        type: 'agent',
        title: 'Work',
        roleId: 'dev',
        prompt: 'Go',
        workspace: 'run',
        resultContract: { type: 'object' },
        artifacts: [],
        question: { timeoutMs: 1000, escalationGraceMs: 1000 }
      },
      { id: 'end', type: 'end', title: 'End' }
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'work' },
      { id: 'e2', from: 'work', to: 'end' }
    ]
  })
}

describe('workflow definition RPC methods', () => {
  let repoPath: string
  let repo: Repo

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'orca-workflow-definitions-rpc-'))
    repo = { id: 'repo-1', path: repoPath, displayName: 'Repo', badgeColor: '#000', addedAt: 0 }
  })

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true })
  })

  function dispatcher(): RpcDispatcher {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handlers under test only call showRepo; the rest of OrcaRuntimeService's surface is never reached.
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      showRepo: vi.fn().mockResolvedValue(repo)
    } as unknown as OrcaRuntimeService
    return new RpcDispatcher({ runtime, methods: WORKFLOW_DEFINITION_METHODS })
  }

  it('writes then reads a workflow, and lists it as valid', async () => {
    const d = dispatcher()
    const write = await d.dispatch(
      makeRequest('workflow.write', {
        repo: 'path:unused',
        name: 'demo',
        definition: minimalWorkflow({ description: 'A demo workflow' })
      })
    )
    expect(write.ok).toBe(true)
    expect(write.ok && write.result).toMatchObject({ revision: expect.any(String) })

    const read = await d.dispatch(
      makeRequest('workflow.read', { repo: 'path:unused', name: 'demo' })
    )
    expect(read.ok).toBe(true)
    expect(read.ok && read.result).toMatchObject({
      definition: { name: 'demo', description: 'A demo workflow' },
      problems: []
    })

    const list = await d.dispatch(makeRequest('workflow.list', { repo: 'path:unused' }))
    expect(list.ok).toBe(true)
    expect(list.ok && list.result).toMatchObject({
      workflows: [
        {
          name: 'demo',
          source: 'project',
          description: 'A demo workflow',
          valid: true
        }
      ]
    })
  })

  it('refuses to write a repository skill source that is not on the repo allowlist', async () => {
    const d = dispatcher()
    const response = await d.dispatch(
      makeRequest('workflow.write', {
        repo: 'path:unused',
        name: 'demo',
        definition: agentWorkflowWithSkillSource({
          kind: 'repository',
          location: 'https://example.com/not-allowlisted'
        })
      })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_source_not_allowed' } })
    expect(response.ok || response.error.data).toMatchObject({
      problems: [
        expect.objectContaining({
          code: 'graph_skill_source_not_allowlisted',
          roleId: 'dev'
        })
      ],
      allowlistPath: expect.stringContaining('orca.yaml')
    })

    const list = await d.dispatch(makeRequest('workflow.list', { repo: 'path:unused' }))
    expect(list.ok && list.result).toMatchObject({ workflows: [] })
  })

  it('reports invalid_argument writing without a definition', async () => {
    const d = dispatcher()
    const response = await d.dispatch(
      makeRequest('workflow.write', { repo: 'path:unused', name: 'demo' })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  })

  it('reports invalid_argument validating without a definition', async () => {
    const d = dispatcher()
    const response = await d.dispatch(makeRequest('workflow.validate', { repo: 'path:unused' }))
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  })

  it('allows a plugin skill source with no allowlist involved', async () => {
    const d = dispatcher()
    const response = await d.dispatch(
      makeRequest('workflow.write', {
        repo: 'path:unused',
        name: 'demo',
        definition: agentWorkflowWithSkillSource({ kind: 'plugin', plugin: 'superpowers' })
      })
    )
    expect(response.ok).toBe(true)
  })

  it('fails workflow_file_conflict when expectedRevision is stale', async () => {
    const d = dispatcher()
    await d.dispatch(
      makeRequest('workflow.write', {
        repo: 'path:unused',
        name: 'demo',
        definition: minimalWorkflow()
      })
    )
    const response = await d.dispatch(
      makeRequest('workflow.write', {
        repo: 'path:unused',
        name: 'demo',
        definition: minimalWorkflow({ description: 'edited' }),
        expectedRevision: 'stale'
      })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_file_conflict' } })
  })

  it('reports structural problems from workflow.validate without writing anything', async () => {
    const d = dispatcher()
    const response = await d.dispatch(
      makeRequest('workflow.validate', {
        repo: 'path:unused',
        definition: minimalWorkflow({
          nodes: [{ id: 'start', type: 'start', title: 'Start' }],
          edges: []
        })
      })
    )
    expect(response.ok).toBe(true)
    expect(response.ok && response.result).toMatchObject({
      problems: [expect.objectContaining({ code: 'graph_missing_end', severity: 'error' })]
    })

    const list = await d.dispatch(makeRequest('workflow.list', { repo: 'path:unused' }))
    expect(list.ok && list.result).toMatchObject({ workflows: [] })
  })

  it('deletes a workflow; reading it afterward reports workflow_not_found', async () => {
    const d = dispatcher()
    await d.dispatch(
      makeRequest('workflow.write', {
        repo: 'path:unused',
        name: 'demo',
        definition: minimalWorkflow()
      })
    )
    const del = await d.dispatch(
      makeRequest('workflow.delete', { repo: 'path:unused', name: 'demo' })
    )
    expect(del).toMatchObject({ ok: true, result: {} })

    const read = await d.dispatch(
      makeRequest('workflow.read', { repo: 'path:unused', name: 'demo' })
    )
    expect(read).toMatchObject({ ok: false, error: { code: 'workflow_not_found' } })
  })

  it('reports workflow_not_found deleting a workflow that does not exist', async () => {
    const d = dispatcher()
    const del = await d.dispatch(
      makeRequest('workflow.delete', { repo: 'path:unused', name: 'missing' })
    )
    expect(del).toMatchObject({ ok: false, error: { code: 'workflow_not_found' } })
  })

  it('duplicates a workflow under a new name, refusing workflow_name_taken on a repeat', async () => {
    const d = dispatcher()
    await d.dispatch(
      makeRequest('workflow.write', {
        repo: 'path:unused',
        name: 'demo',
        definition: minimalWorkflow()
      })
    )
    const duplicate = await d.dispatch(
      makeRequest('workflow.duplicate', { repo: 'path:unused', name: 'demo', newName: 'demo-copy' })
    )
    expect(duplicate.ok).toBe(true)
    expect(duplicate.ok && duplicate.result).toMatchObject({
      name: 'demo-copy',
      revision: expect.any(String)
    })

    const copyRead = await d.dispatch(
      makeRequest('workflow.read', { repo: 'path:unused', name: 'demo-copy' })
    )
    expect(copyRead.ok && copyRead.result).toMatchObject({ definition: { name: 'demo-copy' } })

    const secondDuplicate = await d.dispatch(
      makeRequest('workflow.duplicate', { repo: 'path:unused', name: 'demo', newName: 'demo-copy' })
    )
    expect(secondDuplicate).toMatchObject({ ok: false, error: { code: 'workflow_name_taken' } })
  })

  it('refuses to duplicate a workflow whose source is not on the repo allowlist', async () => {
    // workflow.write itself refuses a non-allowlisted source, so this file could only exist by
    // predating a stricter allowlist or being written by another host — written directly at the
    // file-store level (bypassing the RPC write refusal) to set that scenario up.
    await writeWorkflow(repo, 'project', 'tainted', NON_ALLOWLISTED_SOURCE_WORKFLOW_YAML, null)
    const d = dispatcher()
    const response = await d.dispatch(
      makeRequest('workflow.duplicate', { repo: 'path:unused', name: 'tainted', newName: 'copy' })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_source_not_allowed' } })

    const list = await d.dispatch(makeRequest('workflow.list', { repo: 'path:unused' }))
    expect(list.ok && list.result).toMatchObject({
      workflows: [expect.objectContaining({ name: 'tainted' })]
    })
  })
})
