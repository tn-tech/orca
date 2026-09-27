// Per-run deterministic loop (research R1–R3): rehydrate from the DB, drain the engine Run's
// mailbox backlog, then sleep on the exclusive Run-mailbox waiter. worker_done drives result
// capture and the frontier; every change is recorded and announced (WorkflowRunRecorder).
import type { WorkflowRunState } from '../../../shared/workflows/workflow-node-states'
import type { RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { MessageRow } from '../orchestration/types'
import type { MessageWaitResult } from '../runtime-message-waiters'
import { settleAgentQuestions } from './workflow-agent-question-settlement'
import { raiseAgentQuestion } from './workflow-agent-questions'
import { settleApprovals } from './workflow-approval-gates'
import {
  createWorkflowOrchestrationClient,
  type WorkflowOrchestrationClient,
  type WorkflowOrchestrationDispatcher
} from './workflow-orchestration-client'
import {
  armQuestionDeadlineTimer,
  type WorkflowQuestionListener
} from './workflow-question-deadlines'
import { advanceRun } from './workflow-run-advance'
import { classifyRunMail } from './workflow-run-mailbox-message'
import {
  resumeAnsweredTrustWaits,
  type WorkflowNodeLaunchContext,
  type WorkflowRunWorkspaceAccess
} from './workflow-run-node-launch'
import { WorkflowRunRecorder, type WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { settleRunIfQuiet } from './workflow-run-settlement'
import { registerWorkflowRunWaker } from './workflow-run-wake'
import { releaseRunSkills } from './workflow-skill-provisioning-host'
import { handleWorkerDone } from './workflow-worker-done'

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
  /** `workflow-attention` notification seams; run and change events always fire. */
  onApprovalEscalated?: WorkflowQuestionListener
  onAgentQuestionRaised?: WorkflowQuestionListener
  onAgentQuestionEscalated?: WorkflowQuestionListener
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
  private wakeSignal = new AbortController()
  private readonly recorder: WorkflowRunRecorder

  constructor(private readonly deps: WorkflowRunControllerDeps) {
    this.recorder = new WorkflowRunRecorder(deps.db, deps.runtime, deps.workflowRunId)
  }

  /** Re-checks persisted state now, e.g. after a trust question was answered (FR-018a). */
  wake(): void {
    this.wakeSignal.abort()
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
    const unregisterWaker = registerWorkflowRunWaker(run.id, () => this.wake())
    try {
      await this.advance(session)
      return await this.consumeMailbox(session)
    } finally {
      unregisterWaker()
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
      // Also on rehydrate: an answer recorded while no controller ran resumes here.
      if (await this.settleQuestions(session.launch)) {
        await this.advance(session)
        continue
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
      const wake = this.wakeSignal
      const disarm = armQuestionDeadlineTimer(db, this.deps.workflowRunId, () => wake.abort())
      const woke = await runtime
        .waitForMessage(`run:${session.engineRunId}`, {
          exclusive: true,
          signal: AbortSignal.any([this.abort.signal, wake.signal])
        })
        .finally(disarm)
      if (wake.signal.aborted) {
        this.wakeSignal = new AbortController()
      }
      if (woke === 'waiter_exists') {
        this.recorder.event('mailbox_waiter_conflict', { engineRunId: session.engineRunId })
        throw new Error(`Run ${session.engineRunId} mailbox already has another consumer.`)
      }
    }
    return this.readRun().state
  }

  private async settleQuestions(launch: WorkflowNodeLaunchContext): Promise<boolean> {
    const { onApprovalEscalated, onAgentQuestionEscalated } = this.deps
    return (
      (await resumeAnsweredTrustWaits(launch)) ||
      (await settleApprovals(launch, { onEscalated: onApprovalEscalated })) ||
      (await settleAgentQuestions(launch, { onEscalated: onAgentQuestionEscalated }))
    )
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
        this.recorder.event('mailbox_message_deferred', summary, {
          attemptId: mail.attempt.id,
          reason: 'attempt'
        })
        return
      case 'question':
        // Stored before the delivery is acknowledged; a replay finds it already stored.
        raiseAgentQuestion(session.launch, message, mail, this.deps.onAgentQuestionRaised)
        return
      case 'worker_done':
        if (await handleWorkerDone(session.launch, message, mail)) {
          await this.advance(session)
        }
    }
  }

  /** Advances the run until the frontier is quiet, then settles it. */
  private async advance(session: ControllerSession): Promise<void> {
    await advanceRun(session.launch)
    settleRunIfQuiet(this.deps.db, this.recorder)
  }
}
