// Every workflow state change goes through here: persist it, append a workflow_run_events row,
// then announce it with notifyWorkflowRunChanged so clients refetch (research R7).
import type {
  WorkflowRunChangedPayload,
  WorkflowRunChangedReason
} from '../../../shared/runtime-client-events'
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { Node } from '../../../shared/workflows/workflow-definition-types'
import type {
  WorkflowAttemptState,
  WorkflowRunState
} from '../../../shared/workflows/workflow-node-states'
import type { NodeAttemptView, RunSnapshot } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { closeOpenApprovals } from './workflow-approval-deadlines'
import type { WorkflowAttemptDispatchStore } from './workflow-node-dispatch'

export type WorkflowRunChangeNotifier = {
  notifyWorkflowRunChanged(payload: WorkflowRunChangedPayload): void
}

export type WorkflowEventPayload = Record<string, JsonValue>

const TERMINAL_RUN_STATES: ReadonlySet<WorkflowRunState> = new Set([
  'completed',
  'failed',
  'cancelled'
])

export class WorkflowRunRecorder {
  constructor(
    private readonly db: OrchestrationDb,
    private readonly notifier: WorkflowRunChangeNotifier,
    readonly runId: string
  ) {}

  event(
    kind: string,
    payload: WorkflowEventPayload,
    options: { attemptId?: string; reason?: WorkflowRunChangedReason } = {}
  ): void {
    this.db.appendWorkflowEvent({
      runId: this.runId,
      ...(options.attemptId ? { attemptId: options.attemptId } : {}),
      kind,
      payloadJson: payload
    })
    this.notifier.notifyWorkflowRunChanged({
      runId: this.runId,
      reason: options.reason ?? 'state'
    })
  }

  transitionRun(
    toState: WorkflowRunState,
    kind: string,
    payload: WorkflowEventPayload = {}
  ): RunSnapshot | undefined {
    const run = this.db.transitionWorkflowRun(this.runId, toState)
    this.event(kind, { state: toState, ...payload })
    if (TERMINAL_RUN_STATES.has(toState)) {
      closeOpenApprovals(this.db, this)
    }
    return run
  }

  createAttempt(node: Pick<Node, 'id' | 'type'>, iteration = 0): NodeAttemptView {
    const attempt = this.db.createWorkflowAttempt({
      runId: this.runId,
      nodeId: node.id,
      nodeType: node.type,
      iteration
    })
    this.attemptEvent('attempt_created', attempt, {})
    return attempt
  }

  transitionAttempt(
    attemptId: string,
    toState: WorkflowAttemptState,
    payload: WorkflowEventPayload = {}
  ): NodeAttemptView | undefined {
    const attempt = this.db.transitionWorkflowAttempt(attemptId, toState)
    if (attempt) {
      this.attemptEvent(`attempt_${toState}`, attempt, payload)
    }
    return attempt
  }

  /** Fails an attempt that never reached worker-start; `pending` cannot go straight to `failed`. */
  failBeforeDispatch(attemptId: string, failureReason: string): void {
    this.transitionAttempt(attemptId, 'provisioning')
    this.db.updateWorkflowAttempt(attemptId, { failureReason })
    this.transitionAttempt(attemptId, 'failed')
  }

  /** Hands node dispatch (U18) a store whose transitions are recorded like every other one. */
  dispatchStore(): WorkflowAttemptDispatchStore {
    return {
      transitionWorkflowAttempt: (id, toState) => this.transitionAttempt(id, toState),
      updateWorkflowAttempt: (id, patch) => this.db.updateWorkflowAttempt(id, patch)
    }
  }

  private attemptEvent(kind: string, attempt: NodeAttemptView, payload: WorkflowEventPayload) {
    this.event(
      kind,
      {
        nodeId: attempt.nodeId,
        iteration: attempt.iteration,
        state: attempt.state,
        ...(attempt.failureReason ? { failureReason: attempt.failureReason } : {}),
        ...payload
      },
      { attemptId: attempt.id, reason: 'attempt' }
    )
  }
}
