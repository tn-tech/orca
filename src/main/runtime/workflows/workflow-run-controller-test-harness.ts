// Real OrchestrationDb, RpcDispatcher and runtime mailbox wake path; only terminal/worktree
// placement is faked, so worker_done travels orchestration.send -> Run mailbox -> waitForMessage.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import type { Node, Workflow } from '../../../shared/workflows/workflow-definition-types'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import type { RpcResponse } from '../rpc/core'
import { RpcDispatcher } from '../rpc/dispatcher'
import { ORCHESTRATION_METHODS } from '../rpc/methods/orchestration'
import { WORKFLOW_ENGINE_WORKER_INPUT_METHODS } from '../rpc/methods/workflows/workflow-engine-worker-input-methods'
import { localWorkflowFilesystem } from './workflow-file-store-filesystem'
import { WorkflowRunController, type WorkflowRunControllerDeps } from './workflow-run-controller'

export const RUN_WORKTREE_ID = 'repo::run'

function agentNode(id: string, roleId: string, required: string[]): Node {
  return {
    id,
    type: 'agent',
    title: id === 'implement' ? 'Implement' : 'Review',
    roleId,
    prompt: `Do ${id} for \${objective}.`,
    workspace: 'run',
    resultContract: {
      type: 'object',
      required,
      properties: Object.fromEntries(required.map((key) => [key, { type: 'string' }]))
    },
    artifacts: [],
    question: { timeoutMs: 600_000, escalationGraceMs: 300_000 }
  }
}

export const TWO_NODE_WORKFLOW: Workflow = {
  version: 1,
  name: 'two-node',
  workspacePolicy: 'run-workspace',
  roles: {
    developer: {
      id: 'developer',
      name: 'Developer',
      agent: 'codex',
      systemPrompt: 'Implement it.',
      skills: []
    },
    reviewer: {
      id: 'reviewer',
      name: 'Reviewer',
      agent: 'codex',
      systemPrompt: 'Review.',
      skills: []
    }
  },
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    agentNode('implement', 'developer', ['summary']),
    agentNode('review', 'reviewer', ['verdict']),
    { id: 'end', type: 'end', title: 'Done' }
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'implement' },
    { id: 'e2', from: 'implement', to: 'review' },
    { id: 'e3', from: 'review', to: 'end' }
  ],
  layout: {}
}

// Why: the worker number keeps parallel workers on distinct panes (one active dispatch per pane).
function paneKeyFor(handle: string): string {
  const suffix = (/(\d+)$/.exec(handle)?.[1] ?? String(handle.length)).padStart(12, '0')
  return `tab_${handle}:bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`
}

export function createControllerHarness(workspaceRoot: string) {
  const db = new OrchestrationDb(':memory:')
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  // Same method set as the runtime's workflow engine dispatcher (orca-runtime.ts).
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: [...ORCHESTRATION_METHODS, ...WORKFLOW_ENGINE_WORKER_INPUT_METHODS]
  })
  const workerHandles: string[] = []
  const prompts = new Map<string, string>()
  const workerStartedAt: number[] = []
  let requestSequence = 0

  vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
    handle.startsWith('term_') ? paneKeyFor(handle) : null
  )
  vi.spyOn(runtime, 'getLiveTerminalPaneKey').mockImplementation((handle) =>
    runtime.getTerminalPaneKey(handle)
  )
  vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockImplementation((handle) =>
    handle.startsWith('term_') ? `runtime_test:${handle}:1` : null
  )
  vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
  // Partial fake: worker-start reads only the id of the run workspace.
  Object.assign(runtime, {
    showManagedTerminalWorkspace: vi.fn(async () => ({ id: RUN_WORKTREE_ID }))
  })
  vi.spyOn(runtime, 'createTerminal').mockImplementation(async () => {
    const handle = `term_worker_${workerHandles.length + 1}`
    workerHandles.push(handle)
    workerStartedAt.push(Date.now())
    return { handle, worktreeId: RUN_WORKTREE_ID, title: handle }
  })
  vi.spyOn(runtime, 'waitForTerminal').mockImplementation(async (handle) => ({
    handle,
    condition: 'tui-idle',
    satisfied: true,
    status: 'running',
    exitCode: null
  }))
  vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
  vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockImplementation(async (handle, prompt) => {
    prompts.set(handle, prompt)
    return { handle, accepted: true, bytesWritten: prompt.length }
  })
  const notifyWorkflowRunChanged = vi.spyOn(runtime, 'notifyWorkflowRunChanged')

  function createRun(workflow: Workflow = TWO_NODE_WORKFLOW) {
    return db.createWorkflowRun({
      workflowName: workflow.name,
      workflowSource: 'project',
      workflowSnapshot: workflow,
      workflowVersion: 'v1',
      objective: 'add a greeting',
      repoId: 'repo',
      worktreeId: RUN_WORKTREE_ID
    })
  }

  function createController(
    workflowRunId: string,
    extra: Pick<
      WorkflowRunControllerDeps,
      'onApprovalEscalated' | 'onAgentQuestionRaised' | 'onAgentQuestionEscalated'
    > = {}
  ): WorkflowRunController {
    return new WorkflowRunController({
      ...extra,
      workflowRunId,
      db,
      runtime,
      dispatcher,
      resolveWorkspace: async () => ({
        worktreeId: RUN_WORKTREE_ID,
        workspaceRoot,
        fs: localWorkflowFilesystem,
        orcaIgnoreTarget: { host: 'local', repoPath: workspaceRoot }
      })
    })
  }

  async function writeResult(relativePath: string, value: unknown): Promise<void> {
    const target = join(workspaceRoot, relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, JSON.stringify(value), 'utf-8')
  }

  /** What the worker's CLI does: `orchestration send --type worker_done` with its dispatch capability. */
  async function sendWorkerDone(args: {
    handle: string
    taskId: string
    dispatchId: string
    reportPath: string
    outcome?: 'succeeded' | 'failed'
  }): Promise<RpcResponse> {
    const capability = /--dispatch-capability (\S+)/.exec(prompts.get(args.handle) ?? '')?.[1]
    requestSequence += 1
    return dispatcher.dispatch({
      id: `worker_done_${requestSequence}`,
      authToken: 'test-token',
      method: 'orchestration.send',
      params: {
        from: args.handle,
        type: 'worker_done',
        subject: 'done',
        body: `finished ${args.taskId}`,
        payload: JSON.stringify({
          taskId: args.taskId,
          dispatchId: args.dispatchId,
          outcome: args.outcome ?? 'succeeded',
          reportPath: args.reportPath
        })
      },
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: `worker_done_request_${requestSequence}`,
      ...(capability ? { orchestrationCapability: capability } : {})
    })
  }

  /** What the worker's CLI does: `orchestration ask` blocks until answered, closed or timed out. */
  function askQuestion(args: {
    handle: string
    question: string
    options?: string
    timeoutMs?: number
  }): Promise<RpcResponse> {
    const capability = /--dispatch-capability (\S+)/.exec(prompts.get(args.handle) ?? '')?.[1]
    requestSequence += 1
    return dispatcher.dispatch({
      id: `ask_${requestSequence}`,
      authToken: 'test-token',
      method: 'orchestration.ask',
      params: {
        from: args.handle,
        question: args.question,
        ...(args.options ? { options: args.options } : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {})
      },
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: `ask_request_${requestSequence}`,
      ...(capability ? { orchestrationCapability: capability } : {})
    })
  }

  return {
    db,
    runtime,
    dispatcher,
    workerHandles,
    workerStartedAt,
    notifyWorkflowRunChanged,
    createRun,
    createController,
    writeResult,
    sendWorkerDone,
    askQuestion
  }
}

/** Yields to real I/O; advances the fake clock only when nothing else can make progress. */
export async function waitUntil(condition: () => boolean, maxFakeMs = 10_000): Promise<void> {
  let advanced = 0
  for (let spins = 0; !condition(); spins += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (spins % 50 === 49) {
      if (advanced >= maxFakeMs) {
        throw new Error('condition not reached before the fake-clock budget ran out')
      }
      await vi.advanceTimersByTimeAsync(100)
      advanced += 100
    }
  }
}
