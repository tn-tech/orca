import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import type { RpcRequest, RpcResponse } from '../rpc/core'
import { RpcDispatcher } from '../rpc/dispatcher'
import { WORKFLOW_RUN_METHODS } from '../rpc/methods/workflows/runs'
import type { RuntimeStore } from '../runtime-store-contract'
import {
  registerSshFilesystemProvider,
  unregisterSshFilesystemProvider
} from '../../providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from '../../providers/types'
import {
  ATTEMPT_LIVENESS_INTERVAL_MS,
  WORKER_EXITED_WITHOUT_REPORT_REASON
} from './workflow-attempt-liveness'
import { WorkflowEngine } from './workflow-engine'
import { readPath } from './workflow-follow-up-interrupt'
import {
  createControllerHarness,
  RUN_WORKTREE_ID,
  TWO_NODE_WORKFLOW,
  waitUntil
} from './workflow-run-controller-test-harness'
import { pauseWorkflowRun, resumeWorkflowRun } from './workflow-run-control'

type Verdict = 'live' | 'unverifiable' | 'exited'
type WorkerListAnswer = Verdict | 'unlisted' | 'throws'

describe('WorkflowRunController rehydration and dispatch liveness', () => {
  let workspaceRoot: string
  let h: ReturnType<typeof createControllerHarness>

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'workflow-run-rehydrate-'))
    h = createControllerHarness(workspaceRoot)
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    h.db.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  const attempt = (runId: string, nodeId: string): NodeAttemptView | undefined =>
    h.db.listWorkflowAttempts(runId).find((candidate) => candidate.nodeId === nodeId)
  const events = (runId: string, kind: string) =>
    h.db.listWorkflowEvents(runId).filter((event) => event.kind === kind)

  async function settle(): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  /**
   * Scripts the host's worker-list verdicts and, while `hang` names a method, never answers it:
   * the process "crashed" inside that call after the host applied it.
   */
  function interceptEngineCalls() {
    const state: {
      answer: WorkerListAnswer
      reason: string
      hang: string | undefined
      workerLists: number
      workerStarts: number
      /** Runs as the host answers worker-list, e.g. a report sent just before the worker exits. */
      onWorkerList?: () => Promise<unknown>
      /** Drops a child placement request, which the harness cannot create a worktree for. */
      startInPlace?: boolean
    } = {
      answer: 'live',
      reason: 'host_unavailable',
      hang: undefined,
      workerLists: 0,
      workerStarts: 0
    }
    const dispatch = h.dispatcher.dispatchAsWorkflowEngine.bind(h.dispatcher)
    vi.spyOn(h.dispatcher, 'dispatchAsWorkflowEngine').mockImplementation(
      async (request: RpcRequest, ...rest): Promise<RpcResponse> => {
        if (request.method === 'orchestration.workerStart') {
          state.workerStarts += 1
        }
        if (request.method === 'orchestration.workerList') {
          state.workerLists += 1
          await state.onWorkerList?.()
          return workerListReply(request, state.answer, state.reason)
        }
        const params: unknown = request.params
        const forwarded =
          state.startInPlace && request.method === 'orchestration.workerStart'
            ? { ...request, params: { ...Object(params), worktree: undefined } }
            : request
        const response = await dispatch(forwarded, ...rest)
        if (state.hang === request.method) {
          return new Promise<RpcResponse>(() => {})
        }
        return response
      }
    )
    return state
  }

  function workerListReply(
    request: RpcRequest,
    answer: WorkerListAnswer,
    reason: string
  ): RpcResponse {
    if (answer === 'throws') {
      return {
        id: request.id,
        ok: false,
        error: { code: 'internal_error', message: 'relay closed' },
        _meta: { runtimeId: 'test' }
      }
    }
    const runId: unknown = readPath(request.params, ['run'])
    const dispatches = h.db
      .listWorkflowAttempts(h.db.listActiveWorkflowRuns()[0]?.id ?? '')
      .flatMap((candidate) => (candidate.dispatchId ? [candidate.dispatchId] : []))
    const workers =
      answer === 'unlisted'
        ? []
        : dispatches.map((dispatchId) => ({
            dispatchId,
            runId,
            projection: {
              dispatchId,
              liveness:
                answer === 'unverifiable'
                  ? { verdict: answer, reason }
                  : answer === 'live'
                    ? { verdict: answer, observedAt: Date.now(), source: 'agent_status' }
                    : { verdict: answer, source: 'execution_host' }
            }
          }))
    return { id: request.id, ok: true, result: { workers }, _meta: { runtimeId: 'test' } }
  }

  async function reportDone(runId: string, nodeId: string, result: Record<string, unknown>) {
    const found = attempt(runId, nodeId)
    const handle = found?.dispatchId
      ? h.db.getWorkerDispatch(found.dispatchId)?.agent_terminal_handle
      : undefined
    if (!found?.taskId || !found.dispatchId || !found.resultPath || !handle) {
      throw new Error(`${nodeId} is not dispatched`)
    }
    await h.writeResult(found.resultPath, result)
    await h.sendWorkerDone({
      handle,
      taskId: found.taskId,
      dispatchId: found.dispatchId,
      reportPath: found.resultPath
    })
  }

  /** Runs a first controller until `implement` is running, then "restarts" the runtime. */
  async function runningThenRestart() {
    const run = h.createRun()
    const first = h.createController(run.id)
    const firstDone = first.run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    first.stop()
    await firstDone
    return run
  }

  it('resumes waiting on a running attempt after a restart without re-dispatching it', async () => {
    const calls = interceptEngineCalls()
    const run = await runningThenRestart()
    const dispatched = attempt(run.id, 'implement')
    expect(calls.workerStarts).toBe(1)

    const finished = h.createController(run.id).run()
    await waitUntil(() => calls.workerLists > 0)
    await settle()
    expect(attempt(run.id, 'implement')).toMatchObject({
      id: dispatched?.id,
      state: 'running',
      dispatchId: dispatched?.dispatchId
    })
    expect(calls.workerStarts).toBe(1)
    expect(h.workerHandles).toHaveLength(1)
    expect(h.db.listWorkflowAttempts(run.id).filter((a) => a.nodeId === 'implement')).toHaveLength(
      1
    )

    await reportDone(run.id, 'implement', { summary: 'ok' })
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    expect(calls.workerStarts).toBe(2)
    await reportDone(run.id, 'review', { verdict: 'ok' })
    await expect(finished).resolves.toBe('completed')
  })

  it('marks an attempt unverifiable, never failed, when remote contact is lost, and running again once live', async () => {
    const calls = interceptEngineCalls()
    const run = await runningThenRestart()
    calls.answer = 'unverifiable'

    const finished = h.createController(run.id).run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'unverifiable')
    const lost = events(run.id, 'attempt_unverifiable')
    expect(lost).toHaveLength(1)
    expect(lost[0]?.payloadJson).toMatchObject({ reason: 'host_unavailable' })

    // Silence never becomes an exit: later sweeps that still cannot verify change nothing.
    await vi.advanceTimersByTimeAsync(ATTEMPT_LIVENESS_INTERVAL_MS * 3)
    await settle()
    expect(attempt(run.id, 'implement')?.state).toBe('unverifiable')
    expect(events(run.id, 'attempt_failed')).toHaveLength(0)
    expect(h.db.getWorkflowRun(run.id)?.state).toBe('running')

    calls.answer = 'live'
    await vi.advanceTimersByTimeAsync(ATTEMPT_LIVENESS_INTERVAL_MS)
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    expect(calls.workerStarts).toBe(1)

    await reportDone(run.id, 'implement', { summary: 'ok' })
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    await reportDone(run.id, 'review', { verdict: 'ok' })
    await expect(finished).resolves.toBe('completed')
  })

  it('notices contact loss mid-run on the periodic liveness sweep', async () => {
    const calls = interceptEngineCalls()
    const run = h.createRun()
    const controller = h.createController(run.id)
    const finished = controller.run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    calls.answer = 'unverifiable'
    calls.reason = 'stale_status'

    await vi.advanceTimersByTimeAsync(ATTEMPT_LIVENESS_INTERVAL_MS)
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'unverifiable')
    expect(events(run.id, 'attempt_unverifiable')[0]?.payloadJson).toMatchObject({
      reason: 'stale_status'
    })
    // A worker_done from the unverifiable worker still settles it.
    await reportDone(run.id, 'implement', { summary: 'ok' })
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'completed')
    controller.stop()
    await finished
  })

  it('treats an unlisted worker or an unanswerable worker-list as unverifiable', async () => {
    const calls = interceptEngineCalls()
    const run = await runningThenRestart()
    calls.answer = 'throws'
    const controller = h.createController(run.id)
    const finished = controller.run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'unverifiable')
    expect(events(run.id, 'attempt_unverifiable')[0]?.payloadJson).toMatchObject({
      reason: 'liveness_unreadable',
      detail: 'relay closed'
    })

    calls.answer = 'live'
    await vi.advanceTimersByTimeAsync(ATTEMPT_LIVENESS_INTERVAL_MS)
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    calls.answer = 'unlisted'
    await vi.advanceTimersByTimeAsync(ATTEMPT_LIVENESS_INTERVAL_MS)
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'unverifiable')
    expect(events(run.id, 'attempt_unverifiable')[1]?.payloadJson).toMatchObject({
      reason: 'not_listed'
    })

    expect(events(run.id, 'attempt_failed')).toHaveLength(0)
    controller.stop()
    await finished
  })

  it('fails an attempt the host confirmed exited once the mailbox holds no report from it', async () => {
    const calls = interceptEngineCalls()
    const run = await runningThenRestart()
    const exiting = attempt(run.id, 'implement')
    const taskId = exiting?.taskId ?? ''
    // What the host records when it observes the worker's process end.
    h.db.db
      .prepare("UPDATE dispatch_contexts SET status = 'failed' WHERE id = ?")
      .run(exiting?.dispatchId ?? '')
    calls.answer = 'exited'

    await expect(h.createController(run.id).run()).resolves.toBe('failed')
    expect(attempt(run.id, 'implement')).toMatchObject({
      state: 'failed',
      failureReason: WORKER_EXITED_WITHOUT_REPORT_REASON
    })
    expect(events(run.id, 'attempt_failed')[0]?.payloadJson).toMatchObject({
      reason: 'worker_exited'
    })
    expect(h.db.getTask(taskId)?.status).toBe('failed')
    expect(attempt(run.id, 'review')?.state).toBe('skipped')
    expect(calls.workerStarts).toBe(1)
  })

  it('settles from the worker_done an exiting worker sent in the same sweep, never failing it', async () => {
    const calls = interceptEngineCalls()
    const run = await runningThenRestart()
    calls.answer = 'exited'
    calls.onWorkerList = async () => {
      calls.onWorkerList = undefined
      await reportDone(run.id, 'implement', { summary: 'ok' })
    }

    const finished = h.createController(run.id).run()
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    calls.answer = 'live'
    expect(attempt(run.id, 'implement')).toMatchObject({
      state: 'completed',
      resultJson: { summary: 'ok' }
    })
    expect(events(run.id, 'attempt_failed')).toHaveLength(0)
    await reportDone(run.id, 'review', { verdict: 'ok' })
    await expect(finished).resolves.toBe('completed')
  })

  it('marks running workers unverifiable while an SSH host is unreachable at rehydrate, then resumes', async () => {
    const run = await runningThenRestart()
    const connectionId = 'ssh-rehydrate-gone'
    Object.assign(h.runtime, {
      showManagedWorktree: async () => ({ id: RUN_WORKTREE_ID, path: workspaceRoot })
    })
    const engine = new WorkflowEngine({
      db: h.db,
      runtime: h.runtime,
      dispatcher: h.dispatcher,
      getRepo: (repoId) => ({
        id: repoId,
        path: workspaceRoot,
        displayName: 'Remote',
        badgeColor: '#000',
        addedAt: 0,
        connectionId
      }),
      hostUnreachableRetryDelayMs: 3_600_000
    })
    try {
      engine.rehydrateActiveRuns()
      await waitUntil(() => attempt(run.id, 'implement')?.state === 'unverifiable')
      expect(events(run.id, 'attempt_unverifiable')[0]?.payloadJson).toMatchObject({
        reason: 'host_unavailable'
      })
      await settle()
      expect(h.db.getWorkflowRun(run.id)?.state).toBe('running')
      expect(events(run.id, 'attempt_failed')).toHaveLength(0)

      // The host comes back: the retried controller re-reads the verdict and the worker is live.
      registerSshFilesystemProvider(connectionId, throwingFilesystemProvider())
      await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
      expect(h.workerHandles).toHaveLength(1)
    } finally {
      unregisterSshFilesystemProvider(connectionId)
      await engine.stop()
    }
  })

  it('reads real worker-list verdicts: a reporting agent stays running across a restart', async () => {
    const workerList = vi.spyOn(h.dispatcher, 'dispatchAsWorkflowEngine')
    const run = await runningThenRestart()
    const controller = h.createController(run.id)
    const finished = controller.run()
    await waitUntil(() =>
      workerList.mock.calls.some(([request]) => request.method === 'orchestration.workerList')
    )
    await settle()
    expect(attempt(run.id, 'implement')?.state).toBe('running')
    expect(events(run.id, 'attempt_unverifiable')).toHaveLength(0)
    controller.stop()
    await finished
  })

  it('reads real worker-list verdicts: an agent with no status evidence is unverifiable', async () => {
    h.db.close()
    h = createControllerHarness(workspaceRoot, { agentStatus: 'silent' })
    const run = await runningThenRestart()
    const controller = h.createController(run.id)
    const finished = controller.run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'unverifiable')
    expect(events(run.id, 'attempt_unverifiable')[0]?.payloadJson).toMatchObject({
      reason: 'missing_status'
    })
    expect(h.workerHandles).toHaveLength(1)
    controller.stop()
    await finished
  })

  it('adopts the Dispatch of an attempt a crash left provisioning instead of starting another worker', async () => {
    const calls = interceptEngineCalls()
    calls.hang = 'orchestration.workerStart'
    const run = h.createRun()
    const first = h.createController(run.id)
    void first.run()
    await waitUntil(() => calls.workerStarts === 1)
    await settle()
    first.stop()
    const interrupted = attempt(run.id, 'implement')
    expect(interrupted).toMatchObject({ state: 'provisioning' })
    expect(interrupted?.dispatchId).toBeUndefined()
    calls.hang = undefined

    const finished = h.createController(run.id).run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    const adopted = attempt(run.id, 'implement')
    expect(adopted?.dispatchId).toBe(
      interrupted?.taskId ? h.db.getDispatchContext(interrupted.taskId)?.id : 'missing'
    )
    expect(adopted?.transcriptRef).toEqual({ kind: 'dispatch', id: adopted?.dispatchId })
    expect(adopted).toMatchObject({
      requestedLaunch: { agent: 'codex' },
      effectiveLaunch: { agent: 'codex' },
      workspaceWorktreeId: RUN_WORKTREE_ID
    })
    expect(calls.workerStarts).toBe(1)
    expect(h.workerHandles).toHaveLength(1)
    expect(events(run.id, 'attempt_dispatch_adopted')).toHaveLength(1)

    await reportDone(run.id, 'implement', { summary: 'ok' })
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    await reportDone(run.id, 'review', { verdict: 'ok' })
    await expect(finished).resolves.toBe('completed')
  })

  /** Crashes inside worker-start after the host accepted it; returns the interrupted attempt. */
  async function crashInsideWorkerStart(
    workflow = TWO_NODE_WORKFLOW,
    options: { startInPlace?: boolean } = {}
  ) {
    const calls = interceptEngineCalls()
    calls.hang = 'orchestration.workerStart'
    calls.startInPlace = options.startInPlace === true
    const run = h.createRun(workflow)
    void h.createController(run.id).run()
    await waitUntil(() => calls.workerStarts === 1)
    await settle()
    calls.hang = undefined
    const interrupted = attempt(run.id, 'implement')
    const dispatch = h.db.getDispatchContext(interrupted?.taskId ?? '')
    if (!interrupted?.taskId || !dispatch) {
      throw new Error('worker start did not reach the host')
    }
    return { run, calls, interrupted, dispatch }
  }

  it('records the child worktree a child-workspace node was started in when adopting it', async () => {
    const childWorkflow = {
      ...TWO_NODE_WORKFLOW,
      nodes: TWO_NODE_WORKFLOW.nodes.map((node) =>
        node.id === 'implement' && node.type === 'agent'
          ? { ...node, workspace: 'child' as const }
          : node
      )
    }
    // The harness cannot create worktrees, so the start runs in place and the host's record of
    // the child worktree it would have created is written the way worker-start writes it.
    const { run, dispatch: started } = await crashInsideWorkerStart(childWorkflow, {
      startInPlace: true
    })
    h.db.db
      .prepare('UPDATE worker_dispatches SET effects = ?, worktree_id = ? WHERE dispatch_id = ?')
      .run(
        JSON.stringify([{ kind: 'worktree', action: 'created', id: 'repo::child-1' }]),
        'repo::child-1',
        started.id
      )

    const controller = h.createController(run.id)
    const finished = controller.run()
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    expect(attempt(run.id, 'implement')).toMatchObject({
      dispatchId: started.id,
      workspaceWorktreeId: 'repo::child-1',
      effectiveLaunch: { agent: 'codex' }
    })
    controller.stop()
    await finished
  })

  it('fails, never adopts, an interrupted attempt whose Dispatch failed without a report', async () => {
    const { run, calls, dispatch } = await crashInsideWorkerStart()
    h.db.db
      .prepare("UPDATE dispatch_contexts SET status = 'failed', last_failure = ? WHERE id = ?")
      .run('Agent did not become ready (exited).', dispatch.id)

    await expect(h.createController(run.id).run()).resolves.toBe('failed')
    expect(attempt(run.id, 'implement')).toMatchObject({
      state: 'failed',
      dispatchId: dispatch.id,
      failureReason: 'Agent did not become ready (exited).'
    })
    expect(events(run.id, 'attempt_dispatch_adopted')).toHaveLength(0)
    expect(calls.workerStarts).toBe(1)
  })

  it('adopts an interrupted attempt whose settled Dispatch left a worker_done, so the report settles it', async () => {
    const { run, dispatch, interrupted } = await crashInsideWorkerStart()
    const handle = h.db.getWorkerDispatch(dispatch.id)?.agent_terminal_handle ?? ''
    await h.writeResult(interrupted.resultPath ?? '', { summary: 'done while down' })
    await h.sendWorkerDone({
      handle,
      taskId: interrupted.taskId ?? '',
      dispatchId: dispatch.id,
      reportPath: interrupted.resultPath ?? ''
    })
    expect(h.db.getDispatchContext(interrupted.taskId ?? '')?.status).toBe('completed')

    const finished = h.createController(run.id).run()
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    expect(attempt(run.id, 'implement')).toMatchObject({
      state: 'completed',
      resultJson: { summary: 'done while down' }
    })
    expect(events(run.id, 'attempt_dispatch_adopted')).toHaveLength(1)
    await reportDone(run.id, 'review', { verdict: 'ok' })
    await expect(finished).resolves.toBe('completed')
  })

  it('re-drives an attempt a crash left pending after its Task was created, reusing that Task', async () => {
    const calls = interceptEngineCalls()
    calls.hang = 'orchestration.taskCreate'
    const run = h.createRun()
    const first = h.createController(run.id)
    void first.run()
    const engineTasks = () => h.db.listTasks({ runId: h.db.getRunForWorkflowRun(run.id)?.id })
    await waitUntil(() => engineTasks().length === 1)
    await settle()
    first.stop()
    expect(attempt(run.id, 'implement')).toMatchObject({ state: 'pending' })
    expect(attempt(run.id, 'implement')?.taskId).toBeUndefined()
    calls.hang = undefined

    // A paused run re-drives nothing until it resumes.
    pauseWorkflowRun(h.db, h.runtime, run.id)
    const finished = h.createController(run.id).run()
    await settle()
    expect(attempt(run.id, 'implement')?.state).toBe('pending')
    expect(calls.workerStarts).toBe(0)

    resumeWorkflowRun(h.db, h.runtime, run.id)
    await waitUntil(() => attempt(run.id, 'implement')?.state === 'running')
    expect(engineTasks()).toHaveLength(1)
    expect(attempt(run.id, 'implement')?.taskId).toBe(engineTasks()[0]?.id)
    expect(calls.workerStarts).toBe(1)
    expect(h.db.listWorkflowAttempts(run.id).filter((a) => a.nodeId === 'implement')).toHaveLength(
      1
    )

    await reportDone(run.id, 'implement', { summary: 'ok' })
    await waitUntil(() => attempt(run.id, 'review')?.state === 'running')
    await reportDone(run.id, 'review', { verdict: 'ok' })
    await expect(finished).resolves.toBe('completed')
  })
})

describe('workflow.run.start against an unreachable SSH host (FR-038)', () => {
  let repoPath: string
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService

  const sshRepo = (): Repo => ({
    id: 'repo-ssh',
    path: repoPath,
    displayName: 'Remote',
    badgeColor: '#000',
    addedAt: 0,
    connectionId: 'ssh-gone'
  })

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'workflow-run-ssh-gone-'))
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService(sshStoreFixture(sshRepo()))
    runtime.setOrchestrationDb(db)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    db.close()
    await rm(repoPath, { recursive: true, force: true })
  })

  it('refuses with workflow_host_unreachable and creates no workspace or run', async () => {
    const createWorktree = vi.spyOn(runtime, 'createManagedWorktree')
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKFLOW_RUN_METHODS })
    const response = await dispatcher.dispatch({
      id: 'req-1',
      authToken: 'tok',
      method: 'workflow.run.start',
      params: { repo: `id:${sshRepo().id}`, name: 'two-node', objective: 'go', source: 'project' }
    })
    expect(response).toMatchObject({ ok: false, error: { code: 'workflow_host_unreachable' } })
    expect(createWorktree).not.toHaveBeenCalled()
    expect(db.listActiveWorkflowRuns()).toHaveLength(0)
    expect(await readdir(repoPath)).toEqual([])
  })

  it('refuses at start validation, before any workspace, when the workflow itself was readable', async () => {
    const engine = runtime.getWorkflowEngine()
    await expect(
      engine.startRun({
        workflow: TWO_NODE_WORKFLOW,
        workflowSource: 'personal',
        workflowVersion: 'v1',
        objective: 'go',
        repo: sshRepo(),
        validation: { agentSupportsModel: () => true, isKnownAgent: () => true }
      })
    ).rejects.toThrow('workflow_host_unreachable')
    expect(db.listActiveWorkflowRuns()).toHaveLength(0)
    expect(await readdir(repoPath)).toEqual([])
    await engine.stop()
  })
})

function sshStoreFixture(repo: Repo): RuntimeStore {
  return {
    getRepo: (id) => (id === repo.id ? repo : undefined),
    getRepos: () => [repo],
    addRepo: () => {},
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: run.start never updates the repo through this fixture; the return value is never read.
    updateRepo: () => undefined as never,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a refused run.start never sets worktree meta through this fixture.
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

/** Registered only to make the host reachable; the resumed controller reads no files. */
function throwingFilesystemProvider(): IFilesystemProvider {
  const unused = (): never => {
    throw new Error('not used by this test')
  }
  return {
    readDir: unused,
    readFile: unused,
    writeFile: unused,
    writeFileBase64: unused,
    writeFileBase64Chunk: unused,
    stat: unused,
    deletePath: unused,
    createFile: unused,
    createDir: unused,
    createDirNoClobber: unused,
    rename: unused,
    renameNoClobber: unused,
    copy: unused,
    realpath: unused,
    search: unused,
    listFiles: unused,
    watch: unused
  }
}
