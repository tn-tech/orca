import { describe, expect, it, vi } from 'vitest'
import type { AgentNode, Workflow } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { dispatchWorkflowNode } from './workflow-node-dispatch'
import type { WorkflowSkillProvisioningOutcome } from './workflow-skill-provisioning'

const node: AgentNode = {
  id: 'review',
  type: 'agent',
  title: 'Review',
  roleId: 'reviewer',
  prompt: 'review it',
  workspace: 'run',
  resultContract: { type: 'object' },
  artifacts: [],
  question: { timeoutMs: 1000, escalationGraceMs: 1000 }
}

const roles: Workflow['roles'] = {
  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    agent: 'claude',
    systemPrompt: 'Review.',
    skills: []
  }
}

function attemptView(state: NodeAttemptView['state']): NodeAttemptView {
  return {
    id: 'wfa_1',
    runId: 'wfr_1',
    nodeId: 'review',
    nodeType: 'agent',
    iteration: 0,
    attemptIndex: 0,
    state,
    artifactsJson: []
  }
}

function dispatchWith(
  provisionSkills: (agent: string) => Promise<WorkflowSkillProvisioningOutcome>
) {
  const attemptStore = {
    transitionWorkflowAttempt: vi.fn((_id: string, to: NodeAttemptView['state']) =>
      attemptView(to)
    ),
    updateWorkflowAttempt: vi.fn((_id: string, _patch: unknown) => attemptView('provisioning'))
  }
  const call = vi.fn(async () => ({ dispatchId: 'wdp_1', state: 'ready' }))
  const provision = vi.fn(provisionSkills)
  const result = dispatchWorkflowNode({
    port: { call },
    attemptStore,
    runId: 'wfr_1',
    attemptId: 'wfa_1',
    taskId: 'task_1',
    node,
    roles,
    workspacePolicy: 'run-workspace',
    provisionSkills: provision
  })
  return { result, attemptStore, call, provision }
}

describe('dispatchWorkflowNode — skill provisioning (US4 AS3/AS4)', () => {
  it('provisions for the resolved agent while provisioning, then starts the worker', async () => {
    const { result, attemptStore, call, provision } = dispatchWith(async () => ({
      kind: 'ready',
      installed: ['model-review']
    }))

    expect((await result).ok).toBe(true)
    expect(provision).toHaveBeenCalledWith('claude')
    expect(attemptStore.transitionWorkflowAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      provision.mock.invocationCallOrder[0]
    )
    expect(provision.mock.invocationCallOrder[0]).toBeLessThan(call.mock.invocationCallOrder[0])
  })

  it('fails the node with the reason and never calls workerStart when provisioning fails', async () => {
    const { result, attemptStore, call } = dispatchWith(async () => ({
      kind: 'failed',
      reason: 'Installing skill "model-review" exited with code 1'
    }))

    const outcome = await result
    expect(outcome).toMatchObject({
      ok: false,
      failureReason: 'Installing skill "model-review" exited with code 1'
    })
    expect(attemptStore.transitionWorkflowAttempt).toHaveBeenLastCalledWith('wfa_1', 'failed')
    expect(call).not.toHaveBeenCalled()
  })

  it('fails the node naming the source when a plugin needs a trust decision', async () => {
    const { result, call } = dispatchWith(async () => ({
      kind: 'trust-required',
      question: { source: 'acme-decks', skills: ['deck-writer'], agents: ['claude'] }
    }))

    const outcome = await result
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.failureReason).toContain('acme-decks')
    expect(call).not.toHaveBeenCalled()
  })

  it('fails the node when provisioning throws', async () => {
    const { result, call } = dispatchWith(async () => {
      throw new Error('npx not found')
    })

    expect(await result).toMatchObject({ ok: false, failureReason: 'npx not found' })
    expect(call).not.toHaveBeenCalled()
  })
})
