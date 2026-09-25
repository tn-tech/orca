import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as workflowClient from './runtime-workflow-client'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'

const localCall = vi.fn()
const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()

const localSettings = { activeRuntimeEnvironmentId: null }
const environmentSettings = { activeRuntimeEnvironmentId: 'env-1' }

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  localCall.mockReset()
  localCall.mockResolvedValue({ ok: true, result: { ok: true } })
  runtimeEnvironmentCall.mockReset()
  runtimeEnvironmentCall.mockResolvedValue({ id: 'rpc-1', ok: true, result: { ok: true } })
  runtimeEnvironmentTransportCall.mockReset()
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })
  vi.stubGlobal('window', {
    api: {
      runtime: { call: localCall },
      runtimeEnvironments: { call: runtimeEnvironmentTransportCall }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Every workflow.* method, invoked against the local target: confirms each wrapper forwards
// its call to `callRuntimeRpc` with the method name and params the contract expects.
const cases: { label: string; invoke: () => Promise<unknown>; method: string; params: unknown }[] =
  [
    {
      label: 'workflow.list',
      invoke: () => workflowClient.workflowList(localSettings, 'repo-1'),
      method: 'workflow.list',
      params: { repo: 'repo-1' }
    },
    {
      label: 'workflow.read',
      invoke: () => workflowClient.workflowRead(localSettings, { repo: 'repo-1', name: 'wf-1' }),
      method: 'workflow.read',
      params: { repo: 'repo-1', name: 'wf-1' }
    },
    {
      label: 'workflow.write',
      invoke: () =>
        workflowClient.workflowWrite(localSettings, {
          repo: 'repo-1',
          name: 'wf-1',
          expectedRevision: 'rev-1'
        }),
      method: 'workflow.write',
      params: { repo: 'repo-1', name: 'wf-1', expectedRevision: 'rev-1' }
    },
    {
      label: 'workflow.validate',
      invoke: () => workflowClient.workflowValidate(localSettings, { repo: 'repo-1' }),
      method: 'workflow.validate',
      params: { repo: 'repo-1' }
    },
    {
      label: 'workflow.delete',
      invoke: () => workflowClient.workflowDelete(localSettings, { repo: 'repo-1', name: 'wf-1' }),
      method: 'workflow.delete',
      params: { repo: 'repo-1', name: 'wf-1' }
    },
    {
      label: 'workflow.duplicate',
      invoke: () =>
        workflowClient.workflowDuplicate(localSettings, {
          repo: 'repo-1',
          name: 'wf-1',
          newName: 'wf-2'
        }),
      method: 'workflow.duplicate',
      params: { repo: 'repo-1', name: 'wf-1', newName: 'wf-2' }
    },
    {
      label: 'workflow.importRole',
      invoke: () =>
        workflowClient.workflowImportRole(localSettings, {
          repo: 'repo-1',
          source: 'https://example.com/role.yaml',
          roleName: 'reviewer'
        }),
      method: 'workflow.importRole',
      params: { repo: 'repo-1', source: 'https://example.com/role.yaml', roleName: 'reviewer' }
    },
    {
      label: 'workflow.draft',
      invoke: () => workflowClient.workflowDraft(localSettings, { repo: 'repo-1', objective: 'x' }),
      method: 'workflow.draft',
      params: { repo: 'repo-1', objective: 'x' }
    },
    {
      label: 'workflow.run.start',
      invoke: () =>
        workflowClient.workflowRunStart(localSettings, {
          repo: 'repo-1',
          name: 'wf-1',
          objective: 'ship it'
        }),
      method: 'workflow.run.start',
      params: { repo: 'repo-1', name: 'wf-1', objective: 'ship it' }
    },
    {
      label: 'workflow.run.list',
      invoke: () => workflowClient.workflowRunList(localSettings, { name: 'wf-1' }),
      method: 'workflow.run.list',
      params: { name: 'wf-1' }
    },
    {
      label: 'workflow.run.show',
      invoke: () => workflowClient.workflowRunShow(localSettings, 'run-1'),
      method: 'workflow.run.show',
      params: { runId: 'run-1' }
    },
    {
      label: 'workflow.run.pause',
      invoke: () => workflowClient.workflowRunPause(localSettings, 'run-1'),
      method: 'workflow.run.pause',
      params: { runId: 'run-1' }
    },
    {
      label: 'workflow.run.resume',
      invoke: () => workflowClient.workflowRunResume(localSettings, 'run-1'),
      method: 'workflow.run.resume',
      params: { runId: 'run-1' }
    },
    {
      label: 'workflow.run.cancel',
      invoke: () => workflowClient.workflowRunCancel(localSettings, 'run-1'),
      method: 'workflow.run.cancel',
      params: { runId: 'run-1' }
    },
    {
      label: 'workflow.run.rerun',
      invoke: () =>
        workflowClient.workflowRunRerun(localSettings, { runId: 'run-1', fromNodeId: 'node-1' }),
      method: 'workflow.run.rerun',
      params: { runId: 'run-1', fromNodeId: 'node-1' }
    },
    {
      label: 'workflow.run.answer',
      invoke: () =>
        workflowClient.workflowRunAnswer(localSettings, { runId: 'run-1', questionId: 'q-1' }),
      method: 'workflow.run.answer',
      params: { runId: 'run-1', questionId: 'q-1' }
    },
    {
      label: 'workflow.run.sendMessage',
      invoke: () =>
        workflowClient.workflowRunSendMessage(localSettings, {
          runId: 'run-1',
          attemptId: 'attempt-1',
          text: 'hi'
        }),
      method: 'workflow.run.sendMessage',
      params: { runId: 'run-1', attemptId: 'attempt-1', text: 'hi' }
    },
    {
      label: 'workflow.run.readNodeOutput',
      invoke: () =>
        workflowClient.workflowRunReadNodeOutput(localSettings, {
          runId: 'run-1',
          attemptId: 'attempt-1'
        }),
      method: 'workflow.run.readNodeOutput',
      params: { runId: 'run-1', attemptId: 'attempt-1' }
    },
    {
      label: 'workflow.run.events',
      invoke: () => workflowClient.workflowRunEvents(localSettings, { runId: 'run-1' }),
      method: 'workflow.run.events',
      params: { runId: 'run-1' }
    },
    {
      label: 'workflow.trust.list',
      invoke: () => workflowClient.workflowTrustList(localSettings),
      method: 'workflow.trust.list',
      params: undefined
    },
    {
      label: 'workflow.trust.decide',
      invoke: () =>
        workflowClient.workflowTrustDecide(localSettings, {
          source: 'github.com/org/repo',
          decision: 'trusted'
        }),
      method: 'workflow.trust.decide',
      params: { source: 'github.com/org/repo', decision: 'trusted' }
    },
    {
      label: 'workflow.proposal.accept',
      invoke: () =>
        workflowClient.workflowProposalAccept(localSettings, {
          runId: 'run-1',
          proposalId: 'proposal-1'
        }),
      method: 'workflow.proposal.accept',
      params: { runId: 'run-1', proposalId: 'proposal-1' }
    },
    {
      label: 'workflow.proposal.export',
      invoke: () =>
        workflowClient.workflowProposalExport(localSettings, {
          runId: 'run-1',
          proposalId: 'proposal-1'
        }),
      method: 'workflow.proposal.export',
      params: { runId: 'run-1', proposalId: 'proposal-1' }
    }
  ]

describe('runtime workflow client', () => {
  it.each(cases)('wraps $label over callRuntimeRpc with the local target', async (testCase) => {
    await testCase.invoke()

    expect(localCall).toHaveBeenCalledWith({ method: testCase.method, params: testCase.params })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('routes a definition read through the active runtime environment', async () => {
    await workflowClient.workflowRead(environmentSettings, { repo: 'repo-1', name: 'wf-1' })

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'workflow.read',
      params: { repo: 'repo-1', name: 'wf-1' },
      timeoutMs: 15_000
    })
    expect(localCall).not.toHaveBeenCalled()
  })

  it('gives run-mutating calls a longer timeout on the active runtime environment', async () => {
    await workflowClient.workflowRunStart(environmentSettings, {
      repo: 'repo-1',
      name: 'wf-1',
      objective: 'ship it'
    })

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'workflow.run.start',
      params: { repo: 'repo-1', name: 'wf-1', objective: 'ship it' },
      timeoutMs: 30_000
    })
  })
})
