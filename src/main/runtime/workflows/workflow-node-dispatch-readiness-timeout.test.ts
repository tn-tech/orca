import { describe, expect, it, vi } from 'vitest'
import type { AgentNode } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { dispatchWorkflowNode } from './workflow-node-dispatch'

const node: AgentNode = {
  id: 'scribe',
  type: 'agent',
  title: 'Scribe',
  prompt: 'write',
  workspace: 'run',
  resultContract: { type: 'object' },
  artifacts: [],
  question: { timeoutMs: 1000, escalationGraceMs: 1000 },
  overrides: { agent: 'kimi' }
}

function createAttemptStore() {
  const view = (state: NodeAttemptView['state']): NodeAttemptView => ({
    id: 'wfa_1',
    runId: 'wfr_1',
    nodeId: 'scribe',
    nodeType: 'agent',
    iteration: 0,
    attemptIndex: 0,
    state,
    artifactsJson: []
  })
  return {
    transitionWorkflowAttempt: vi.fn((_id: string, to: NodeAttemptView['state']) => view(to)),
    updateWorkflowAttempt: vi.fn((_id: string, _patch: unknown) => view('provisioning'))
  }
}

async function dispatchWithReceipt(receipt: Record<string, unknown>) {
  const attemptStore = createAttemptStore()
  const outcome = await dispatchWorkflowNode({
    port: { call: vi.fn(async () => receipt) },
    attemptStore,
    runId: 'wfr_1',
    attemptId: 'wfa_1',
    taskId: 'task_1',
    node,
    roles: {},
    workspacePolicy: 'run-workspace'
  })
  return { outcome, attemptStore }
}

const READINESS_HINT =
  'The agent never became ready. It may be waiting on a prompt in its terminal, such as a ' +
  'question about trusting the folder. Open the transcript to see it. (timeout)'

describe('dispatchWorkflowNode readiness timeout reason', () => {
  it.each([
    ['a local start (bare waiter timeout)', 'timeout'],
    ['a federated or unsatisfied wait', 'Agent did not become ready (timeout).']
  ])('explains an agent_readiness timeout from %s', async (_label, lastError) => {
    const { outcome, attemptStore } = await dispatchWithReceipt({
      dispatchId: 'wdp_1',
      state: 'failed',
      failedStage: 'agent_readiness',
      lastError
    })

    expect(outcome).toMatchObject({ ok: false, failureReason: READINESS_HINT })
    expect(attemptStore.updateWorkflowAttempt).toHaveBeenCalledWith('wfa_1', {
      failureReason: READINESS_HINT,
      dispatchId: 'wdp_1'
    })
  })

  it('keeps a specific blocked-prompt reason as the host reported it', async () => {
    const { outcome } = await dispatchWithReceipt({
      dispatchId: 'wdp_1',
      state: 'failed',
      failedStage: 'agent_readiness',
      lastError: 'Agent startup blocked: agent-trust-workspace'
    })

    expect(outcome).toMatchObject({
      failureReason: 'Agent startup blocked: agent-trust-workspace'
    })
  })

  it('keeps a timeout from another stage verbatim', async () => {
    const { outcome } = await dispatchWithReceipt({
      dispatchId: 'wdp_1',
      state: 'failed',
      failedStage: 'dispatch_input',
      lastError: 'timeout'
    })

    expect(outcome).toMatchObject({ failureReason: 'timeout' })
  })
})
