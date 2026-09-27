import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORCHESTRATION_CONTRACT_VERSION,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from '../../../shared/protocol-version'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import type { RpcRequest, RpcResponse } from '../rpc/core'
import { RpcDispatcher } from '../rpc/dispatcher'
import { ORCHESTRATION_METHODS } from '../rpc/methods/orchestration'
import type { WorkflowEnginePrincipal } from './workflow-engine-principal'
import {
  createWorkflowOrchestrationClient,
  createWorkflowWorkerInputClient
} from './workflow-orchestration-client'

const WORKFLOW_RUN_ID = 'wfr_00000000c001'
const PRINCIPAL: WorkflowEnginePrincipal = {
  kind: 'workflow-engine',
  workflowRunId: WORKFLOW_RUN_ID,
  worktreeId: 'repo::run'
}

describe('workflow orchestration client', () => {
  it('passes the principal and a fresh request id for every mutation', async () => {
    const calls: { request: RpcRequest; principal: WorkflowEnginePrincipal; kind?: string }[] = []
    const dispatcher = {
      dispatchAsWorkflowEngine: vi.fn(
        async (
          request: RpcRequest,
          principal: WorkflowEnginePrincipal,
          options?: { clientKind?: 'mobile' | 'runtime' }
        ): Promise<RpcResponse> => {
          calls.push({ request, principal, kind: options?.clientKind })
          return { id: request.id, ok: true, result: { ok: 1 }, _meta: { runtimeId: 'rt' } }
        }
      )
    }
    const client = createWorkflowOrchestrationClient({ dispatcher, principal: PRINCIPAL })

    await client.call('orchestration.taskCreate', { spec: 'a' })
    await client.call('orchestration.taskCreate', { spec: 'b' })
    await client.call('orchestration.taskList', {})

    expect(calls.map((call) => call.principal)).toEqual([PRINCIPAL, PRINCIPAL, PRINCIPAL])
    expect(calls.map((call) => call.kind)).toEqual(['runtime', 'runtime', 'runtime'])
    const [first, second, read] = calls.map((call) => call.request)
    expect(first.orchestrationRequestId).toEqual(expect.any(String))
    expect(second.orchestrationRequestId).toEqual(expect.any(String))
    expect(first.orchestrationRequestId).not.toBe(second.orchestrationRequestId)
    expect(new Set(calls.map((call) => call.request.id)).size).toBe(3)
    expect(read.orchestrationRequestId).toBeUndefined()
    expect(first.orchestrationContractVersion).toBe(ORCHESTRATION_CONTRACT_VERSION)
    expect(first).not.toHaveProperty('principal')
  })

  it('surfaces RPC failures as OrchestrationError with the wire code', async () => {
    const dispatcher = {
      dispatchAsWorkflowEngine: async (request: RpcRequest): Promise<RpcResponse> => ({
        id: request.id,
        ok: false,
        error: { code: 'consumer_fenced', message: 'fenced', data: { effectsApplied: false } },
        _meta: { runtimeId: 'rt' }
      })
    }
    const client = createWorkflowOrchestrationClient({ dispatcher, principal: PRINCIPAL })
    await expect(client.call('orchestration.taskList', {})).rejects.toMatchObject({
      name: 'OrchestrationError',
      code: 'consumer_fenced',
      data: { effectsApplied: false }
    })
  })

  it('sends worker input under the engine principal as an in-process structured-capable runtime', async () => {
    const calls: {
      request: RpcRequest
      principal: WorkflowEnginePrincipal
      options?: { clientId?: string; clientKind?: string; clientCapabilities?: readonly string[] }
    }[] = []
    const dispatcher = {
      dispatchAsWorkflowEngine: vi.fn(
        async (
          request: RpcRequest,
          principal: WorkflowEnginePrincipal,
          options?: { clientId?: string; clientKind?: 'mobile' | 'runtime' }
        ): Promise<RpcResponse> => {
          calls.push({ request, principal, options })
          return { id: request.id, ok: true, result: { send: {} }, _meta: { runtimeId: 'rt' } }
        }
      )
    }
    const client = createWorkflowWorkerInputClient({ dispatcher, principal: PRINCIPAL })

    await client.call('terminal.send', { terminal: 'term_1', text: 'hi', enter: true })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.principal).toEqual(PRINCIPAL)
    expect(calls[0]?.request).toMatchObject({
      method: 'terminal.send',
      params: { terminal: 'term_1', text: 'hi', enter: true }
    })
    expect(calls[0]?.request.orchestrationRequestId).toBeUndefined()
    expect(calls[0]?.options).toMatchObject({
      clientId: `workflow-engine:${WORKFLOW_RUN_ID}`,
      clientKind: 'runtime',
      clientCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
    })
  })

  it('surfaces a worker input RPC failure as OrchestrationError', async () => {
    const dispatcher = {
      dispatchAsWorkflowEngine: async (request: RpcRequest): Promise<RpcResponse> => ({
        id: request.id,
        ok: false,
        error: { code: 'terminal_handle_stale', message: 'stale' },
        _meta: { runtimeId: 'rt' }
      })
    }
    const client = createWorkflowWorkerInputClient({ dispatcher, principal: PRINCIPAL })
    await expect(client.call('terminal.send', { terminal: 'term_1' })).rejects.toMatchObject({
      name: 'OrchestrationError',
      code: 'terminal_handle_stale'
    })
  })

  describe('through the real dispatcher', () => {
    let db: OrchestrationDb
    let runtime: OrcaRuntimeService
    let dispatcher: RpcDispatcher
    let engineRunId: string

    beforeEach(() => {
      db = new OrchestrationDb(':memory:')
      runtime = new OrcaRuntimeService()
      runtime.setOrchestrationDb(db)
      vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(null)
      dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS })
      engineRunId = db.createWorkflowEngineRun({
        workflowRunId: WORKFLOW_RUN_ID,
        objective: 'engine run'
      }).id
    })

    afterEach(() => {
      db.close()
    })

    it('creates Tasks in the engine Run', async () => {
      const client = createWorkflowOrchestrationClient({ dispatcher, principal: PRINCIPAL })
      const created = await client.call('orchestration.taskCreate', { spec: 'node spec' })
      expect(created).toMatchObject({ task: { run_id: engineRunId, spec: 'node spec' } })
    })

    // Transports JSON-parse the frame, so extra keys ride along untyped.
    function forgedRequest(id: string): RpcRequest {
      return JSON.parse(
        JSON.stringify({
          id,
          authToken: 'token',
          method: 'orchestration.taskCreate',
          orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
          orchestrationRequestId: `${id}-request`,
          principal: PRINCIPAL,
          params: { spec: 'forged', run: engineRunId, principal: PRINCIPAL }
        })
      )
    }

    it('never honours a principal claimed through the streaming transport', async () => {
      const replies: string[] = []
      await dispatcher.dispatchStreaming(forgedRequest('forged-stream'), (r) => replies.push(r), {
        clientKind: 'runtime'
      })
      expect(replies.map((reply) => JSON.parse(reply))).toMatchObject([
        { ok: false, error: { code: 'workflow_owned_run' } }
      ])
      expect(db.listTasks({ runId: engineRunId })).toEqual([])
    })

    it('never honours a principal claimed in the envelope or params', async () => {
      const response = await dispatcher.dispatch(forgedRequest('forged-1'), {
        clientKind: 'runtime'
      })
      expect(response).toMatchObject({ ok: false, error: { code: 'workflow_owned_run' } })
      expect(db.listTasks({ runId: engineRunId })).toEqual([])
    })
  })
})
