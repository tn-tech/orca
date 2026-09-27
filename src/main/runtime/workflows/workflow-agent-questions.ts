// Questions a node's agent raises mid-run (FR-033a, spec US5 AS5–AS6, research R8). The worker's
// `orchestration ask` lands as a `question` message in the Run mailbox; the controller stores it as
// an `agent-question` in the run's question store, which owns its state, answer, answerer and
// deadlines, and puts the attempt in Waiting. Other nodes keep running. A person's answer is only
// recorded here (answerAgentQuestion) and wakes the run; the controller then delivers it to the
// agent's existing session (workflow-agent-question-settlement.ts).
import {
  ORCHESTRATION_ASK_DEFAULT_TIMEOUT_MS,
  ORCHESTRATION_ASK_MAX_TIMEOUT_MS
} from '../../../shared/orchestration-ask-timeout'
import type { Node } from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView, RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { MessageRow } from '../orchestration/types'
import {
  atomically,
  expireQuestion,
  questionDeadlines,
  type WorkflowQuestionListener
} from './workflow-question-deadlines'
import type { RunMail } from './workflow-run-mailbox-message'
import type { WorkflowNodeLaunchContext } from './workflow-run-node-launch'
import { WorkflowRunRecorder, type WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { wakeWorkflowRun } from './workflow-run-wake'
import { leaveRunWaitIfClear } from './workflow-trust-wait'

export const AGENT_QUESTION_TIMED_OUT_REASON = 'agent_question_timed_out'

// Why: router and reflection nodes have no `question` config, yet their agents can still ask.
const DEFAULT_QUESTION_TIMING = {
  timeoutMs: ORCHESTRATION_ASK_DEFAULT_TIMEOUT_MS,
  escalationGraceMs: ORCHESTRATION_ASK_DEFAULT_TIMEOUT_MS
}

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled'])

/** Escalation never comes later than the worker's own `ask` wait can last. */
export function agentQuestionDeadlines(
  raisedAt: number,
  node: Node | undefined
): { escalationAt: number; timeoutAt: number } {
  const timing = node?.type === 'agent' ? node.question : DEFAULT_QUESTION_TIMING
  return questionDeadlines(raisedAt, {
    timeoutMs: Math.min(timing.timeoutMs, ORCHESTRATION_ASK_MAX_TIMEOUT_MS),
    escalationGraceMs: timing.escalationGraceMs
  })
}

type AgentQuestion = RunQuestionView & { kind: 'agent-question' }

export function isAgentQuestion(question: RunQuestionView): question is AgentQuestion {
  return question.kind === 'agent-question'
}

export function openAgentQuestions(
  db: OrchestrationDb,
  runId: string,
  attemptId: string
): AgentQuestion[] {
  return db
    .listOpenWorkflowQuestions(runId)
    .filter(isAgentQuestion)
    .filter((question) => question.attemptId === attemptId)
}

function questionContext(node: Node | undefined, options: readonly string[]): string {
  const asker = node ? `Asked by the agent on "${node.title}".` : 'Asked by a node agent.'
  return options.length > 0 ? `${asker} Suggested answers: ${options.join(', ')}.` : asker
}

/**
 * Stores the question and moves its attempt to Waiting in one transaction; a replayed delivery
 * finds the question already stored and changes nothing.
 */
export function raiseAgentQuestion(
  ctx: WorkflowNodeLaunchContext,
  message: MessageRow,
  mail: Extract<RunMail, { kind: 'question' }>,
  onRaised?: WorkflowQuestionListener
): void {
  const { db, recorder } = ctx
  if (db.listWorkflowQuestions(recorder.runId).some((q) => q.questionMessageId === message.id)) {
    return
  }
  const { attempt } = mail
  // Waiting already: the agent asked again, e.g. after its own `ask` wait ran out.
  if (
    attempt.state !== 'running' &&
    attempt.state !== 'unverifiable' &&
    attempt.state !== 'waiting'
  ) {
    recorder.event(
      'agent_question_ignored',
      { messageId: message.id, attemptState: attempt.state },
      { attemptId: attempt.id, reason: 'question' }
    )
    return
  }
  const node = ctx.definition.nodes.find((candidate) => candidate.id === attempt.nodeId)
  let question: RunQuestionView | undefined
  atomically(db, () => {
    question = db.createWorkflowQuestion({
      runId: recorder.runId,
      attemptId: attempt.id,
      kind: 'agent-question',
      questionMessageId: message.id,
      prompt: mail.prompt,
      options: { options: mail.options, context: questionContext(node, mail.options) },
      ...agentQuestionDeadlines(Date.now(), node)
    })
    // Asking proves the worker is alive, so an unverifiable attempt is running again.
    if (attempt.state === 'unverifiable') {
      recorder.transitionAttempt(attempt.id, 'running')
    }
    if (attempt.state !== 'waiting') {
      recorder.transitionAttempt(attempt.id, 'waiting', {
        reason: 'agent-question',
        questionId: question.id
      })
    }
    recorder.event(
      'agent_question_raised',
      { questionId: question.id, messageId: message.id, dispatchId: mail.attempt.dispatchId },
      { attemptId: attempt.id, reason: 'question' }
    )
    if (db.getWorkflowRun(recorder.runId)?.state === 'running') {
      recorder.transitionRun('waiting', 'run_waiting', { reason: 'agent-question' })
    }
  })
  if (question) {
    onRaised?.(question)
  }
}

/**
 * A worker that reported done while waiting on its own question no longer needs the answer: its
 * open questions close and the attempt returns to Running so the report is processed.
 */
export function releaseAgentQuestionWait(
  ctx: WorkflowNodeLaunchContext,
  attempt: NodeAttemptView
): NodeAttemptView | undefined {
  if (attempt.state !== 'waiting' || !attempt.dispatchId) {
    return undefined
  }
  const { db, recorder } = ctx
  let released: NodeAttemptView | undefined
  atomically(db, () => {
    for (const question of openAgentQuestions(db, recorder.runId, attempt.id)) {
      expireQuestion(db, recorder, question, { reason: 'worker_finished' })
    }
    released = recorder.transitionAttempt(attempt.id, 'running', { reason: 'worker_finished' })
  })
  leaveRunWaitIfClear(db, recorder)
  return released
}

function notPending(message: string, data: Record<string, string>): OrchestrationError {
  return new OrchestrationError('workflow_question_not_pending', message, data)
}

/**
 * Records a person's answer to a pending or escalated agent question (first answer wins) and
 * wakes the run, whose controller delivers it. workflow.run.answer calls this for agent questions.
 */
export function answerAgentQuestion(
  db: OrchestrationDb,
  notifier: WorkflowRunChangeNotifier,
  args: { runId: string; questionId: string; answer: string; answeredBy: string }
): RunQuestionView {
  const { runId, questionId, answer, answeredBy } = args
  const question = db.listWorkflowQuestions(runId).find((candidate) => candidate.id === questionId)
  if (!question || !isAgentQuestion(question)) {
    throw notPending(`Run ${runId} has no agent question ${questionId}.`, { runId, questionId })
  }
  const state = db.getWorkflowRun(runId)?.state
  if (state === undefined || TERMINAL_RUN_STATES.has(state)) {
    throw new OrchestrationError('workflow_run_not_active', `Run ${runId} has already ended.`, {
      runId,
      questionId
    })
  }
  if (answer.trim().length === 0) {
    throw new OrchestrationError('invalid_argument', 'An answer cannot be empty.', {
      runId,
      questionId
    })
  }
  const answered = db.answerWorkflowQuestion(questionId, answer, answeredBy)
  if (answered?.state !== 'answered' || question.state === 'answered') {
    throw notPending(`Agent question ${questionId} is no longer open (${answered?.state}).`, {
      runId,
      questionId
    })
  }
  new WorkflowRunRecorder(db, notifier, runId).event(
    'agent_question_answered',
    { questionId, answeredBy },
    { attemptId: question.attemptId, reason: 'question' }
  )
  wakeWorkflowRun(runId)
  return answered
}
