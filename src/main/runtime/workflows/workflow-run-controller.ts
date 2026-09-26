// Per-run deterministic loop (research R1–R3): rehydrate from the DB, drain the engine Run's
// mailbox backlog, then sleep on the exclusive Run-mailbox waiter. worker_done drives result
// capture and the frontier; every change is recorded and announced (WorkflowRunRecorder).
import {
  ACTIVE_ATTEMPT_STATES,
  type WorkflowRunState
} from '../../../shared/workflows/workflow-node-states'
import type { NodeAttemptView, RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { MessageRow } from '../orchestration/types'
import type { MessageWaitResult } from '../runtime-message-waiters'
import { artifactsFor, resultContractFor } from './workflow-brief-builder'
import {
  createWorkflowOrchestrationClient,
  type WorkflowOrchestrationClient,
  type WorkflowOrchestrationDispatcher
} from './workflow-orchestration-client'
import { captureNodeResult } from './workflow-result-capture'
import { captureRouterResult, recordRouterChoice } from './workflow-router'
import { advanceRun } from './workflow-run-advance'
import { classifyRunMail, type RunMail } from './workflow-run-mailbox-message'
import {
  requireBriefNode,
  type WorkflowNodeLaunchContext,
  type WorkflowRunWorkspaceAccess
} from './workflow-run-node-launch'
import { WorkflowRunRecorder, type WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { releaseRunSkills } from './workflow-skill-provisioning-host'

export type WorkflowRunControllerRuntime = WorkflowRunChangeNotifier & {
  waitForMessage(
    handle: string,
    options?: { signal?: AbortSignal; exclusive?: boolean }
  ): Promise<MessageWaitResult>
}

export type WorkflowRunControllerDeps = {
  workflowRunId: string
  db: OrchestrationDb
  runtime: WorkflowRunControllerRuntime
  dispatcher: WorkflowOrchestrationDispatcher
  resolveWorkspace(run: RunSnapshot): Promise<WorkflowRunWorkspaceAccess>
}

const TERMINAL_RUN_STATES = new Set<WorkflowRunState>(['completed', 'failed', 'cancelled'])
type ControllerSession = {
  engineRunId: string
  consumerGeneration: number
  client: WorkflowOrchestrationClient
  launch: WorkflowNodeLaunchContext
}

export class WorkflowRunController {
  private readonly abort = new AbortController()
  private readonly recorder: WorkflowRunRecorder

  constructor(private readonly deps: WorkflowRunControllerDeps) {
    this.recorder = new WorkflowRunRecorder(deps.db, deps.runtime, deps.workflowRunId)
  }

  /** Leaves the run as persisted so a later controller can rehydrate it. */
  stop(): void {
    this.abort.abort()
  }

  /** Resolves with the run's state when it finishes or the controller is stopped. */
  async run(): Promise<WorkflowRunState> {
    const run = this.readRun()
    if (TERMINAL_RUN_STATES.has(run.state)) {
      await releaseRunSkills(run.id, () => this.deps.resolveWorkspace(run))
      return run.state
    }
    const session = await this.openSession(run)
    if (run.state === 'queued') {
      this.recorder.transitionRun('running', 'run_started', {
        orchestrationRunId: session.engineRunId
      })
    }
    try {
      await this.advance(session)
      return await this.consumeMailbox(session)
    } finally {
      if (TERMINAL_RUN_STATES.has(this.readRun().state)) {
        await releaseRunSkills(run.id, async () => session.launch.workspace)
      }
    }
  }

  private readRun(): RunSnapshot {
    const run = this.deps.db.getWorkflowRun(this.deps.workflowRunId)
    if (!run) {
      throw new Error(`Workflow run ${this.deps.workflowRunId} was not found.`)
    }
    return run
  }

  private async openSession(run: RunSnapshot): Promise<ControllerSession> {
    const { db } = this.deps
    const engineRun =
      db.getRunForWorkflowRun(run.id) ??
      db.createWorkflowEngineRun({ workflowRunId: run.id, objective: run.objective })
    const workspace = await this.deps.resolveWorkspace(run)
    const placementWorktreeId = workspace.worktreeId ?? run.worktreeId
    const client = createWorkflowOrchestrationClient({
      dispatcher: this.deps.dispatcher,
      principal: {
        kind: 'workflow-engine',
        workflowRunId: run.id,
        ...(placementWorktreeId ? { worktreeId: placementWorktreeId } : {})
      }
    })
    return {
      engineRunId: engineRun.id,
      consumerGeneration: engineRun.consumer_generation,
      client,
      launch: {
        db,
        recorder: this.recorder,
        client,
        workflowName: run.workflowName,
        objective: run.objective,
        definition: run.workflowSnapshot,
        workspace,
        placementWorktreeId
      }
    }
  }

  private async consumeMailbox(session: ControllerSession): Promise<WorkflowRunState> {
    const { db, runtime } = this.deps
    const mailbox = { runId: session.engineRunId, consumerGeneration: session.consumerGeneration }
    while (!this.abort.signal.aborted) {
      const state = this.readRun().state
      if (TERMINAL_RUN_STATES.has(state)) {
        return state
      }
      // Why: the backlog read and waiter registration share one tick, so no wake is lost between them.
      const batch = db.getOrCreateRunDelivery(mailbox)
      if (batch) {
        for (const message of batch.messages) {
          await this.routeMessage(session, message)
        }
        db.acknowledgeRunDelivery({ ...mailbox, deliveryId: batch.delivery.id })
        continue
      }
      const woke = await runtime.waitForMessage(`run:${session.engineRunId}`, {
        exclusive: true,
        signal: this.abort.signal
      })
      if (woke === 'waiter_exists') {
        this.recorder.event('mailbox_waiter_conflict', { engineRunId: session.engineRunId })
        throw new Error(`Run ${session.engineRunId} mailbox already has another consumer.`)
      }
    }
    return this.readRun().state
  }

  private async routeMessage(session: ControllerSession, message: MessageRow): Promise<void> {
    const mail = classifyRunMail(
      this.deps.db,
      message,
      this.deps.db.listWorkflowAttempts(this.deps.workflowRunId)
    )
    const summary = { messageId: message.id, type: message.type, from: message.from_handle }
    switch (mail.kind) {
      case 'ignored':
        this.recorder.event('mailbox_message_ignored', { ...summary, reason: mail.reason })
        return
      case 'deferred':
        // Seam: question/escalation handling (US4) consumes these; until then they are only logged.
        this.recorder.event('mailbox_message_deferred', summary, {
          attemptId: mail.attempt.id,
          reason: 'attempt'
        })
        return
      case 'worker_done':
        await this.handleWorkerDone(session, message, mail)
    }
  }

  private async handleWorkerDone(
    session: ControllerSession,
    message: MessageRow,
    mail: Extract<RunMail, { kind: 'worker_done' }>
  ): Promise<void> {
    const { attempt } = mail
    const received = { messageId: message.id, dispatchId: mail.dispatchId, outcome: mail.outcome }
    // Replayed deliveries and late reports find the attempt already settled.
    if (attempt.state !== 'running' && attempt.state !== 'unverifiable') {
      this.recorder.event(
        'worker_done_stale',
        { ...received, attemptState: attempt.state },
        {
          attemptId: attempt.id,
          reason: 'attempt'
        }
      )
      return
    }
    this.recorder.event(
      'worker_done_received',
      { ...received, reportPath: mail.reportPath },
      { attemptId: attempt.id, reason: 'attempt' }
    )
    if (attempt.state === 'unverifiable') {
      this.recorder.transitionAttempt(attempt.id, 'running')
    }
    const node = requireBriefNode(session.launch.definition, attempt.nodeId)
    const captureArgs = {
      fs: session.launch.workspace.fs,
      workspaceRoot: session.launch.workspace.workspaceRoot,
      runId: this.deps.workflowRunId,
      attemptId: attempt.id,
      reportPath: mail.reportPath,
      outcome: mail.outcome,
      declaredArtifacts: artifactsFor(node)
    }
    const capture =
      node.type === 'router'
        ? await captureRouterResult(node, captureArgs)
        : await captureNodeResult({ ...captureArgs, resultContract: resultContractFor(node) })
    const { db } = this.deps
    if (capture.ok) {
      db.updateWorkflowAttempt(attempt.id, {
        resultJson: capture.result,
        artifactsJson: capture.artifacts
      })
      // Why: taskCreate readies a successor only once every dep Task is completed.
      await this.ensureTaskStatus(session, attempt.taskId, 'completed')
      if (node.type === 'router') {
        recordRouterChoice(this.recorder, attempt, capture.result)
      }
      this.recorder.transitionAttempt(attempt.id, 'completed')
    } else {
      db.updateWorkflowAttempt(attempt.id, {
        failureReason: capture.failureReason,
        ...(capture.result !== undefined ? { resultJson: capture.result } : {}),
        ...(capture.artifacts ? { artifactsJson: capture.artifacts } : {})
      })
      await this.ensureTaskStatus(session, attempt.taskId, 'failed')
      this.recorder.transitionAttempt(attempt.id, 'failed', {
        workerReport: message.body,
        ...(capture.detail !== undefined ? { detail: capture.detail } : {}),
        ...(capture.rawBody !== undefined ? { rawBody: capture.rawBody } : {})
      })
    }
    await this.advance(session)
  }

  private async ensureTaskStatus(
    session: ControllerSession,
    taskId: string | undefined,
    status: 'completed' | 'failed'
  ): Promise<void> {
    if (taskId && this.deps.db.getTask(taskId)?.status !== status) {
      await session.client.call('orchestration.taskUpdate', { id: taskId, status })
    }
  }

  /** Advances the run until the frontier is quiet, then settles it. */
  private async advance(session: ControllerSession): Promise<void> {
    await advanceRun(session.launch)
    this.settleRunIfQuiet()
  }

  /**
   * Nothing active and nothing eligible: the run is over. It completes only when an End node
   * completed; otherwise a failed node (or an unsupported node type) left End unreachable.
   */
  private settleRunIfQuiet(): void {
    const run = this.readRun()
    if (run.state !== 'running' && run.state !== 'waiting') {
      return
    }
    const attempts = this.deps.db.listWorkflowAttempts(this.deps.workflowRunId)
    // A Waiting Join alone cannot move: its pending branches have nothing left to settle them.
    const stuckJoin = (a: NodeAttemptView) => a.nodeType === 'join' && a.state === 'waiting'
    if (attempts.some((a) => ACTIVE_ATTEMPT_STATES.has(a.state) && !stuckJoin(a))) {
      return
    }
    for (const join of attempts.filter(stuckJoin)) {
      this.recorder.transitionAttempt(join.id, 'cancelled', { reason: 'join_unreachable' })
    }
    if (attempts.some((attempt) => attempt.nodeType === 'end' && attempt.state === 'completed')) {
      this.recorder.transitionRun('completed', 'run_completed')
      return
    }
    const failedNodes = attempts.filter((a) => a.state === 'failed').map((a) => a.nodeId)
    this.recorder.transitionRun('failed', 'run_failed', {
      reason: failedNodes.length > 0 ? 'node_failed' : 'end_unreachable',
      failedNodes
    })
  }
}
