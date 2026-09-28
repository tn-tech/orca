import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcRequest } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { OrcaRuntimeService } from '../../../orca-runtime'
import { OrchestrationDb } from '../../../orchestration/db'
import type { Repo } from '../../../../../shared/repo-types'
import type { RuntimeStore } from '../../../runtime-store-contract'
import { WORKFLOW_DEFINITION_METHODS } from './definitions'
import { WORKFLOW_RUN_METHODS } from './runs'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

/** A draft as the editor's Add-node menu leaves it: the agent node has no role or agent yet. */
const UNASSIGNED_DEFINITION = {
  version: 1,
  name: 'unassigned',
  workspacePolicy: 'run-workspace',
  roles: {},
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    {
      id: 'work',
      type: 'agent',
      title: 'Work',
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
  ],
  layout: {}
}

function storeFixture(repo: Repo): RuntimeStore {
  return {
    getRepo: (id) => (id === repo.id ? repo : undefined),
    getRepos: () => [repo],
    addRepo: () => {},
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods never update the repo through this fixture; the return value is never read.
    updateRepo: () => undefined as never,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the refused run never creates a worktree, so meta is never set through this fixture.
    setWorktreeMeta: () => undefined as never,
    removeWorktreeMeta: () => {},
    getGitHubCache: () => ({ pr: {}, issue: {} }),
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    })
  }
}

describe('workflow with an agent-dispatching node that has no agent assigned', () => {
  let repoPath: string
  let runtime: OrcaRuntimeService
  let db: OrchestrationDb

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'orca-workflow-unassigned-'))
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService(
      storeFixture({
        id: 'repo-1',
        path: repoPath,
        displayName: 'Repo',
        badgeColor: '#000',
        addedAt: 0
      })
    )
    runtime.setOrchestrationDb(db)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await runtime.getWorkflowEngine().stop()
    db.close()
    await rm(repoPath, { recursive: true, force: true })
  })

  function dispatcher(): RpcDispatcher {
    return new RpcDispatcher({
      runtime,
      methods: [...WORKFLOW_DEFINITION_METHODS, ...WORKFLOW_RUN_METHODS]
    })
  }

  it('still saves as a draft, but validate reports graph_node_unassigned', async () => {
    const write = await dispatcher().dispatch(
      makeRequest('workflow.write', {
        repo: repoPath,
        name: 'unassigned',
        definition: UNASSIGNED_DEFINITION
      })
    )
    expect(write.ok).toBe(true)

    const validate = await dispatcher().dispatch(
      makeRequest('workflow.validate', { repo: repoPath, definition: UNASSIGNED_DEFINITION })
    )
    expect(validate).toMatchObject({
      ok: true,
      result: {
        problems: [
          expect.objectContaining({
            code: 'graph_node_unassigned',
            nodeId: 'work',
            severity: 'error'
          })
        ]
      }
    })
  })

  it('refuses workflow.run.start with workflow_invalid before creating any workspace or run', async () => {
    const createWorktree = vi.spyOn(runtime, 'createManagedWorktree')
    await dispatcher().dispatch(
      makeRequest('workflow.write', {
        repo: repoPath,
        name: 'unassigned',
        definition: UNASSIGNED_DEFINITION
      })
    )

    const response = await dispatcher().dispatch(
      makeRequest('workflow.run.start', { repo: repoPath, name: 'unassigned', objective: 'go' })
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_invalid' } })
    expect(response.ok || response.error.data).toMatchObject({
      problems: [expect.objectContaining({ code: 'graph_node_unassigned', nodeId: 'work' })]
    })
    expect(createWorktree).not.toHaveBeenCalled()
    expect(db.listActiveWorkflowRuns()).toHaveLength(0)
  })
})
