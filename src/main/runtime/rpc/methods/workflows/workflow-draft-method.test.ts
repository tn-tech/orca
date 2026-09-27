import { describe, expect, it, vi } from 'vitest'
import type { RpcRequest } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { Repo } from '../../../../../shared/repo-types'
import type { WorkflowStartRunInput } from '../../../workflows/workflow-engine'
import { WORKFLOW_DEFINITION_METHODS } from './definitions'

const REPO: Repo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'Repo',
  badgeColor: '#000',
  addedAt: 0
}

function request(params: unknown): RpcRequest {
  return {
    id: 'req-1',
    authToken: 'tok',
    method: 'workflow.draft',
    params
  }
}

function dispatcherFor(repo: Repo) {
  const startRun = vi.fn(async (input: WorkflowStartRunInput) => ({
    id: 'wfr_draft',
    workflowName: input.workflow.name,
    state: 'queued'
  }))
  const engine = {
    startRun,
    getSnapshot: vi.fn(() => ({ id: 'wfr_draft', repoId: repo.id, state: 'failed' }))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: workflow.draft only reaches showRepo, getWorkflowEngine, getOrchestrationDb, getWorkflowPlannerAgent and removeManagedWorktree.
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    showRepo: vi.fn().mockResolvedValue(repo),
    getWorkflowEngine: () => engine,
    getOrchestrationDb: () => ({ listWorkflowAttempts: () => [] }),
    getWorkflowPlannerAgent: () => 'codex',
    removeManagedWorktree: vi.fn(async () => ({}))
  } as unknown as OrcaRuntimeService
  return {
    dispatcher: new RpcDispatcher({ runtime, methods: WORKFLOW_DEFINITION_METHODS }),
    startRun
  }
}

describe('workflow.draft', () => {
  it('refuses a request with no objective', async () => {
    const { dispatcher, startRun } = dispatcherFor(REPO)
    const response = await dispatcher.dispatch(request({ repo: 'path:/repo', objective: '  ' }))
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(startRun).not.toHaveBeenCalled()
  })

  it('passes workflow_host_unreachable through for an SSH repo whose host is gone', async () => {
    const { dispatcher, startRun } = dispatcherFor({ ...REPO, connectionId: 'ssh-gone' })
    const response = await dispatcher.dispatch(request({ repo: 'path:/repo', objective: 'Go' }))
    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_host_unreachable' } })
    expect(startRun).not.toHaveBeenCalled()
  })

  it('plans with the settings planner agent and records the paired device, never its token', async () => {
    const { dispatcher, startRun } = dispatcherFor(REPO)
    let response: unknown
    // The WebSocket transport's entry point, which carries the paired device identity.
    await dispatcher.dispatchStreaming(
      request({ repo: 'path:/repo', objective: 'Add a greeting' }),
      (raw) => {
        response = JSON.parse(raw)
      },
      { clientId: 'bearer-token-secret', pairedDeviceId: 'device-7', clientKind: 'mobile' }
    )

    expect(response).toMatchObject({
      ok: true,
      result: {
        draft: true,
        runId: 'wfr_draft',
        problems: [expect.objectContaining({ code: 'workflow_draft_failed' })]
      }
    })
    const input = startRun.mock.calls[0]?.[0]
    expect(input?.startedByClient).toBe('device-7')
    expect(input?.objective).toBe('Add a greeting')
    expect(Object.values(input?.workflow.roles ?? {}).map((role) => role.agent)).toEqual(['codex'])
  })
})
