// Approval nodes (FR-033, spec US5, research R8). An eligible Approval gets a placeholder Task and
// a decision gate on it (orchestration.gateCreate), plus an `approval` question in the run's
// question store. The question row owns the approval's state (pending/escalated/answered/expired,
// the answer, answerer and deadlines) because every client reads that one store; the gate mirrors
// it for orchestration: resolved with the answer, or timed out on expiry. Answering only records
// the question (resolveApproval) and wakes the run; the controller then resolves the gate, stores
// `{ option }` as the attempt result and completes it, and the frontier follows that option's
// port. Only the Approval's downstream waits: other ready branches keep running while the run
// shows `waiting`. An option with no outgoing edge stops the whole run
// (workflow-approval-rejection.ts).
import {
  approvalQuestionOptions,
  approvalQuestionSubject
} from '../../../shared/workflows/workflow-approval-question-subject'
import type { ApprovalNode } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView, RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { ApprovalResult } from './workflow-approval-choice'
import { approvalOptionHasEdge, stopRunForApproval } from './workflow-approval-rejection'
import {
  applyApprovalDeadlines,
  type WorkflowApprovalEscalationListener
} from './workflow-approval-deadlines'
import { createNodeTask } from './workflow-frontier-node-task'
import { questionDeadlines } from './workflow-question-deadlines'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'
import { WorkflowRunRecorder, type WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { wakeWorkflowRun } from './workflow-run-wake'
import { leaveRunWaitIfClear } from './workflow-trust-wait'

const WAITING_OR_APPLYING = new Set<NodeAttemptView['state']>(['waiting', 'running'])
const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled'])

function isRunOver(db: OrchestrationDb, runId: string): boolean {
  const state = db.getWorkflowRun(runId)?.state
  return state === undefined || TERMINAL_RUN_STATES.has(state)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function gateIdFromResult(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) {
    return undefined
  }
  const gate: unknown = Reflect.get(result, 'gate')
  const id: unknown = typeof gate === 'object' && gate !== null ? Reflect.get(gate, 'id') : null
  return typeof id === 'string' ? id : undefined
}

function approvalNode(ctx: WorkflowNodeLaunchContext, nodeId: string): ApprovalNode | undefined {
  const node = ctx.definition.nodes.find((candidate) => candidate.id === nodeId)
  return node?.type === 'approval' ? node : undefined
}

/** Gate, question and Waiting for an attempt that has its Task; reuses what a prior open persisted. */
async function raiseApproval(
  ctx: WorkflowNodeLaunchContext,
  node: ApprovalNode,
  attemptId: string,
  taskId: string
): Promise<void> {
  const gateId =
    ctx.db.listGates({ taskId, status: 'pending' })[0]?.id ??
    gateIdFromResult(
      await ctx.client.call('orchestration.gateCreate', {
        task: taskId,
        question: node.question,
        options: JSON.stringify(node.options)
      })
    )
  if (!gateId) {
    throw new Error(`orchestration.gateCreate returned no gate id for node ${node.id}.`)
  }
  const { escalationAt, timeoutAt } = questionDeadlines(Date.now(), node)
  const asked = ctx.db
    .listWorkflowQuestions(ctx.recorder.runId)
    .find((candidate) => candidate.attemptId === attemptId && candidate.kind === 'approval')
  const question =
    asked ??
    ctx.db.createWorkflowQuestion({
      runId: ctx.recorder.runId,
      attemptId,
      kind: 'approval',
      gateId,
      prompt: node.question,
      options: approvalQuestionOptions({
        options: node.options,
        ...(node.defaultOption === undefined ? {} : { defaultOption: node.defaultOption })
      }),
      escalationAt,
      timeoutAt
    })
  for (const state of ['provisioning', 'running'] as const) {
    ctx.recorder.transitionAttempt(attemptId, state)
  }
  ctx.recorder.transitionAttempt(attemptId, 'waiting', {
    reason: 'approval',
    questionId: question.id
  })
  ctx.recorder.event(
    'approval_raised',
    { questionId: question.id, gateId, options: node.options },
    { attemptId, reason: 'question' }
  )
  if (ctx.db.getWorkflowRun(ctx.recorder.runId)?.state === 'running') {
    ctx.recorder.transitionRun('waiting', 'run_waiting', { reason: 'approval' })
  }
  // A reopened attempt reuses its question, which was announced when first asked.
  if (!asked) {
    ctx.recorder.questionAttention('question-raised', question)
  }
}

async function openAttempt(
  ctx: WorkflowNodeLaunchContext,
  node: ApprovalNode,
  attempt: NodeAttemptView,
  attempts: readonly NodeAttemptView[]
): Promise<void> {
  try {
    const taskId =
      attempt.taskId ??
      (await createNodeTask(ctx.client, {
        definition: ctx.definition,
        attempts,
        nodeId: node.id,
        iteration: attempt.iteration,
        spec: node.question
      }))
    if (!attempt.taskId) {
      ctx.db.updateWorkflowAttempt(attempt.id, { taskId })
    }
    await raiseApproval(ctx, node, attempt.id, taskId)
  } catch (error) {
    ctx.recorder.failBeforeDispatch(attempt.id, errorMessage(error))
  }
}

/** Starts an eligible Approval (per Loop iteration inside a Loop body). */
export async function openApproval(
  ctx: WorkflowNodeLaunchContext,
  node: ApprovalNode,
  attempts: readonly NodeAttemptView[],
  iteration: number
): Promise<void> {
  await openAttempt(ctx, node, ctx.recorder.createAttempt(node, iteration), attempts)
}

/** An attempt a stopped runtime left `pending` mid-open resumes from what it persisted. */
async function reopenInterruptedApprovals(ctx: WorkflowNodeLaunchContext): Promise<boolean> {
  const attempts = ctx.db.listWorkflowAttempts(ctx.recorder.runId)
  const interrupted = attempts.filter(
    (attempt) => attempt.nodeType === 'approval' && attempt.state === 'pending'
  )
  for (const attempt of interrupted) {
    const node = approvalNode(ctx, attempt.nodeId)
    if (node) {
      await openAttempt(ctx, node, attempt, attempts)
    }
  }
  return interrupted.length > 0
}

/** Resolves the gate, stores `{ option }` and completes the attempt; idempotent across restarts. */
async function applyAnswer(
  ctx: WorkflowNodeLaunchContext,
  question: RunQuestionView,
  attempt: NodeAttemptView,
  option: string
): Promise<void> {
  if (question.gateId && ctx.db.getGate(question.gateId)?.status === 'pending') {
    await ctx.client.call('orchestration.gateResolve', { id: question.gateId, resolution: option })
  }
  // Why: taskCreate readies a successor only once every dep Task is completed.
  if (attempt.taskId && ctx.db.getTask(attempt.taskId)?.status !== 'completed') {
    await ctx.client.call('orchestration.taskUpdate', { id: attempt.taskId, status: 'completed' })
  }
  const result: ApprovalResult = { option }
  ctx.db.updateWorkflowAttempt(attempt.id, { resultJson: result })
  // Why before completing: a completed Approval reads as a routed one, so a stop cut short by a
  // restart must still find this attempt open and replay.
  if (!approvalOptionHasEdge(ctx, attempt.nodeId, option)) {
    await stopRunForApproval(ctx, attempt, option)
  }
  if (attempt.state === 'waiting') {
    ctx.recorder.transitionAttempt(attempt.id, 'running')
  }
  ctx.recorder.transitionAttempt(attempt.id, 'completed', {
    questionId: question.id,
    option,
    ...(question.answeredBy ? { answeredBy: question.answeredBy } : {})
  })
}

async function applyAnsweredApprovals(ctx: WorkflowNodeLaunchContext): Promise<boolean> {
  const attempts = new Map(
    ctx.db.listWorkflowAttempts(ctx.recorder.runId).map((attempt) => [attempt.id, attempt])
  )
  let applied = false
  for (const question of ctx.db.listWorkflowQuestions(ctx.recorder.runId)) {
    const attempt = attempts.get(question.attemptId)
    if (
      question.kind !== 'approval' ||
      question.state !== 'answered' ||
      question.answer === undefined ||
      attempt?.nodeType !== 'approval' ||
      !WAITING_OR_APPLYING.has(attempt.state)
    ) {
      continue
    }
    await applyAnswer(ctx, question, attempt, question.answer)
    applied = true
    if (isRunOver(ctx.db, ctx.recorder.runId)) {
      break
    }
  }
  return applied
}

/**
 * Brings every Approval of the run up to date from persisted state: reopens interrupted ones,
 * applies due escalations and timeouts, then routes answered ones. `true` when anything changed,
 * so the caller advances the frontier. Only the run's single controller calls it.
 */
export async function settleApprovals(
  ctx: WorkflowNodeLaunchContext,
  options: { now?: number; onEscalated?: WorkflowApprovalEscalationListener } = {}
): Promise<boolean> {
  const reopened = await reopenInterruptedApprovals(ctx)
  const timed = await applyApprovalDeadlines(ctx, options.now ?? Date.now(), options.onEscalated)
  const answered = await applyAnsweredApprovals(ctx)
  if (timed || answered) {
    leaveRunWaitIfClear(ctx.db, ctx.recorder)
  }
  return reopened || timed || answered
}

function notPending(message: string, data: Record<string, string>): OrchestrationError {
  return new OrchestrationError('workflow_question_not_pending', message, data)
}

/**
 * Records a person's answer to a pending or escalated approval (first answer wins) and wakes the
 * run, whose controller routes it (settleApprovals). workflow.run.answer calls this for approvals.
 */
export function resolveApproval(
  db: OrchestrationDb,
  notifier: WorkflowRunChangeNotifier,
  args: { runId: string; questionId: string; optionId: string; answeredBy: string }
): RunQuestionView {
  const { runId, questionId, optionId, answeredBy } = args
  const question = db.listWorkflowQuestions(runId).find((candidate) => candidate.id === questionId)
  const subject = question ? approvalQuestionSubject(question) : undefined
  if (!question || !subject) {
    throw notPending(`Run ${runId} has no approval ${questionId}.`, { runId, questionId })
  }
  if (isRunOver(db, runId)) {
    throw new OrchestrationError('workflow_run_not_active', `Run ${runId} has already ended.`, {
      runId,
      questionId
    })
  }
  if (!subject.options.includes(optionId)) {
    throw new OrchestrationError(
      'invalid_argument',
      `"${optionId}" is not an option of approval ${questionId}.`,
      { runId, questionId, options: subject.options.join(', ') }
    )
  }
  const answered = db.answerWorkflowQuestion(questionId, optionId, answeredBy)
  if (answered?.state !== 'answered' || question.state === 'answered') {
    throw notPending(`Approval ${questionId} is no longer open (${answered?.state}).`, {
      runId,
      questionId
    })
  }
  new WorkflowRunRecorder(db, notifier, runId).event(
    'approval_answered',
    { questionId, option: optionId, answeredBy },
    { attemptId: question.attemptId, reason: 'question' }
  )
  wakeWorkflowRun(runId)
  return answered
}
