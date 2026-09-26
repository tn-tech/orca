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

function dispatchWithTrustWait() {
  const attemptStore = {
    transitionWorkflowAttempt: vi.fn((_id: string, to: NodeAttemptView['state']) =>
      attemptView(to)
    ),
    updateWorkflowAttempt: vi.fn((_id: string, _patch: unknown) => attemptView('provisioning'))
  }
  const call = vi.fn(async () => ({ dispatchId: 'wdp_1', state: 'ready' }))
  const question = { source: 'acme-decks', skills: ['deck-writer'], agents: ['claude'] }
  const onTrustRequired = vi.fn(() => attemptView('waiting'))
  const result = dispatchWorkflowNode({
    port: { call },
    attemptStore,
    runId: 'wfr_1',
    attemptId: 'wfa_1',
    taskId: 'task_1',
    node,
    roles,
    workspacePolicy: 'run-workspace',
    provisionSkills: async (): Promise<WorkflowSkillProvisioningOutcome> => ({
      kind: 'trust-required',
      question
    }),
    onTrustRequired
  })
  return { result, attemptStore, call, onTrustRequired, question }
}

describe('dispatchWorkflowNode — trust wait (FR-018a)', () => {
  it('parks the attempt on the trust question instead of failing it, starting no worker', async () => {
    const { result, attemptStore, call, onTrustRequired, question } = dispatchWithTrustWait()

    const outcome = await result
    expect(outcome).toMatchObject({ ok: false, waitingForTrust: question })
    expect(outcome.attempt?.state).toBe('waiting')
    expect(onTrustRequired).toHaveBeenCalledWith(question)
    expect(attemptStore.transitionWorkflowAttempt).not.toHaveBeenCalledWith('wfa_1', 'failed')
    expect(attemptStore.updateWorkflowAttempt).not.toHaveBeenCalled()
    expect(call).not.toHaveBeenCalled()
  })
})
