// "Interrupt now" into a structured worker through the shipping `agentSession.send`: the RPC
// dispatcher, capability gate, durable record, lease and mutation ledger are real, and the caller
// is the workflow engine (`workflow-engine:<runId>`). Only the Codex app-server child is faked.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CodexAppServerConnection,
  CodexAppServerConnectionHandlers,
  openCodexAppServerConnection
} from '../../codex/codex-app-server-connection'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import {
  AGENT_SESSION_PENDING_SEND_RESULT_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from '../../../shared/protocol-version'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/structured-agent-session-registry'
import type { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import type { RpcResponse } from '../rpc/core'
import { RpcDispatcher } from '../rpc/dispatcher'
import { WORKFLOW_ENGINE_WORKER_INPUT_METHODS } from '../rpc/methods/workflows/workflow-engine-worker-input-methods'
import { STRUCTURED_AGENT_SESSION_METHODS } from '../rpc/methods/structured-agent-session'
import {
  ensureStructuredAgentSessionHost,
  stopStructuredAgentSessionRuntime
} from '../structured-agent-session-runtime'
import { AgentAnswerDeliveryBackoff } from './workflow-agent-answer-delivery'
import { deliverFollowUps, queueFollowUp } from './workflow-follow-up-delivery'
import { readPath } from './workflow-follow-up-interrupt'
import {
  createWorkflowOrchestrationClient,
  createWorkflowWorkerInputClient
} from './workflow-orchestration-client'
import { TWO_NODE_WORKFLOW } from './workflow-run-controller-test-harness'
import { WorkflowRunRecorder } from './workflow-run-recorder'

const SESSION = 'session-follow-up-1'
const THREAD = 'thread-follow-up'
const TURN = 'turn-1'
const WORKSPACE = 'workspace-1'
// The desktop that opened the chat; the engine later writes into it as a different caller.
const DESKTOP = {
  clientId: 'device-a',
  clientKind: 'runtime' as const,
  clientCapabilities: [
    AGENT_SESSION_PENDING_SEND_RESULT_RUNTIME_CAPABILITY,
    STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
  ]
}

type FakeConnection = Omit<CodexAppServerConnection, 'closed'> & {
  closed: boolean
  handlers: CodexAppServerConnectionHandlers
  calls: { method: string; params?: Record<string, unknown> }[]
}

let connections: FakeConnection[]
let root: string
let dispatcher: RpcDispatcher
let db: OrchestrationDb

const openConnection: typeof openCodexAppServerConnection = async (_launch, handlers = {}) => {
  const connection: FakeConnection = {
    handlers,
    calls: [],
    pid: 4321,
    closed: false,
    request: async (method, params) => {
      connection.calls.push({ method, params })
      if (method === 'thread/start') {
        return { thread: { id: THREAD, path: '/rollouts/follow-up.jsonl' } }
      }
      if (method === 'model/list') {
        const model = { model: 'gpt-live', displayName: 'GPT Live', hidden: false, isDefault: true }
        return { data: [{ ...model, supportedReasoningEfforts: [], defaultReasoningEffort: null }] }
      }
      return method === 'turn/start' ? { turn: { id: TURN } } : {}
    },
    notify: () => {},
    respond: () => {},
    respondWithError: () => {},
    close: async () => {
      connection.closed = true
      return true
    }
  }
  connections.push(connection)
  return connection
}

function live(): FakeConnection {
  const connection = connections.at(-1)
  if (!connection) {
    throw new Error('no codex app-server has been opened')
  }
  return connection
}

function resolvedCreate() {
  return {
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: WORKSPACE,
      workspaceKind: 'git-worktree' as const
    },
    provider: 'codex' as const,
    agent: 'codex',
    accountHome: { variable: 'CODEX_HOME' as const, path: '/home/dev/.codex' },
    runtimeKind: 'native' as const
  }
}

/** Opens the chat the way the desktop does, returning the session's runtime fence. */
async function createSession(): Promise<number> {
  const fields = { worktree: `id:${WORKSPACE}`, agent: 'codex' }
  const replies: RpcResponse[] = []
  await dispatcher.dispatchStreaming(
    {
      id: 'create-1',
      authToken: 'token',
      method: 'agentSession.create',
      params: {
        envelope: {
          sessionId: SESSION,
          clientOperationId: `${Date.now()}-${'1'.padStart(32, '0')}`,
          expectedRuntimeFence: null,
          payloadFingerprint: computeAgentSessionPayloadFingerprint({
            method: 'agentSession.create',
            sessionId: SESSION,
            fields
          })
        },
        ...fields
      }
    },
    (raw) => replies.push(JSON.parse(raw)),
    DESKTOP
  )
  const reply = replies[0]
  expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true, result: { ok: true } })
  const fence = readPath(reply, ['result', 'value', 'fence'])
  if (typeof fence !== 'number') {
    throw new Error(`expected a numeric runtime fence, got ${JSON.stringify(fence)}`)
  }
  return fence
}

beforeEach(async () => {
  connections = []
  root = await mkdtemp(join(tmpdir(), 'orca-follow-up-structured-'))
  db = new OrchestrationDb(':memory:')
  const runtime = {
    getRuntimeId: () => 'runtime-1',
    getClientSettings: () => ({ experimentalStructuredNativeChat: true }),
    getStructuredAgentSessionCreateSupport: async () => ({ supported: true }),
    resolveStructuredAgentSessionCreateIntent: async () => resolvedCreate(),
    publishStructuredAgentSessionTab: () => {},
    ensureStructuredAgentSessionHost: () =>
      ensureStructuredAgentSessionHost({
        stateDirectory: root,
        hostId: 'local',
        claimKeyId: 'key-1',
        resolveWorkspacePath: async (workspaceId) => `/repos/${workspaceId}`,
        resolveCodexCommand: () => '/usr/local/bin/codex',
        resolveClaudeAuthPolicy: () => ({ stripAuthEnv: true }),
        resolveEnvironment: async () => ({ PATH: '/usr/bin' }),
        resolveCodexOverrides: () => ({}),
        openCodexConnection: openConnection,
        readProcessStartTime: async () => 1_700_000_000_000
      }).then(() => undefined),
    registerOwnedSubscriptionCleanup: vi.fn((_id: string, dispose: () => void) => ({
      releaseIfCurrent: dispose
    })),
    getOrchestrationDb: () => db
  }
  dispatcher = new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a partial runtime with exactly the members the structured host and dispatcher read, as in structured-agent-session-integration.test.ts.
    runtime: runtime as unknown as OrcaRuntimeService,
    methods: [
      ...STRUCTURED_AGENT_SESSION_METHODS.filter((m) => m.name !== 'agentSession.send'),
      ...WORKFLOW_ENGINE_WORKER_INPUT_METHODS
    ]
  })
})

afterEach(async () => {
  await stopStructuredAgentSessionRuntime()
  db.close()
  await rm(root, { recursive: true, force: true })
})

describe('structured interrupt follow-up through the real agentSession.send', () => {
  it('lands one user turn for the engine caller and is delivered once the session accepted it', async () => {
    const fence = await createSession()
    const run = db.createWorkflowRun({
      workflowName: TWO_NODE_WORKFLOW.name,
      workflowSource: 'project',
      workflowSnapshot: TWO_NODE_WORKFLOW,
      workflowVersion: 'v1',
      objective: 'x',
      repoId: 'repo',
      worktreeId: 'repo::run'
    })
    const notifier = { notifyWorkflowRunChanged: () => {} }
    const recorder = new WorkflowRunRecorder(db, notifier, run.id)
    recorder.transitionRun('running', 'run_started')
    const attemptId = recorder.createAttempt({ id: 'implement', type: 'agent' }).id
    recorder.transitionAttempt(attemptId, 'provisioning')
    recorder.transitionAttempt(attemptId, 'running')
    db.updateWorkflowAttempt(attemptId, { dispatchId: 'dispatch_1' })
    const message = queueFollowUp(db, notifier, {
      runId: run.id,
      attemptId,
      text: 'Use postgres.',
      mode: 'interrupt',
      sender: 'mobile_7'
    })
    const principal = { kind: 'workflow-engine' as const, workflowRunId: run.id }
    const followUps = {
      db,
      recorder,
      client: createWorkflowOrchestrationClient({ dispatcher, principal }),
      workerInput: createWorkflowWorkerInputClient({ dispatcher, principal }),
      sendTerminalPrompt: vi.fn(),
      resolveWorker: () => ({
        kind: 'structured' as const,
        sessionId: SESSION,
        runtimeFence: fence
      }),
      backoff: new AgentAnswerDeliveryBackoff()
    }

    await deliverFollowUps(followUps, Date.now())

    const turns = live().calls.filter((call) => call.method === 'turn/start')
    expect(turns).toHaveLength(1)
    // A pending send is in flight, not failing.
    expect(db.listWorkflowEventsOfKind(run.id, 'follow_up_delivery_failed')).toEqual([])
    const clientMessageId = turns[0]?.params?.clientUserMessageId
    live().handlers.onNotification?.('turn/started', { turn: { id: TURN } })
    live().handlers.onNotification?.('item/completed', {
      item: {
        type: 'userMessage',
        id: 'item-0',
        clientId: clientMessageId,
        content: [{ type: 'text', text: 'Use postgres.' }]
      }
    })
    await getStructuredAgentSessionHost()?.flushStreamedEvents(SESSION)
    await vi.waitFor(async () => {
      await deliverFollowUps(followUps, Date.now() + 120_000)
      expect(db.listWorkflowMessages(run.id)).toEqual([
        expect.objectContaining({ id: message.id, state: 'delivered', mode: 'interrupt' })
      ])
    })

    expect(live().calls.filter((call) => call.method === 'turn/start')).toHaveLength(1)
  })
})
