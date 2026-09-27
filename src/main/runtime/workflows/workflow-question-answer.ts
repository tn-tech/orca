// `workflow.run.answer` (FR-033, FR-033a, FR-018a): routes a person's answer by question kind to
// the module that owns it. Approvals and agent questions record the answer and wake the run
// themselves; a trust question is a per-host source decision, so it goes through the same trust
// store as `workflow.trust.decide`, which answers every pending question for that source there.
import type { RunQuestionView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { answerAgentQuestion } from './workflow-agent-questions'
import { resolveApproval } from './workflow-approval-gates'
import type { WorkflowRunChangeNotifier } from './workflow-run-recorder'
import { wakeWorkflowRun } from './workflow-run-wake'
import { decideSourceTrust, trustQuestionSubject } from './workflow-source-trust'

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled'])

export type RunQuestionAnswer = {
  runId: string
  questionId: string
  answer?: string
  optionId?: string
  answeredBy: string
}

function notPending(message: string, data: Record<string, string>): OrchestrationError {
  return new OrchestrationError('workflow_question_not_pending', message, data)
}

function answerTrustQuestion(
  db: OrchestrationDb,
  notifier: WorkflowRunChangeNotifier,
  question: RunQuestionView,
  args: RunQuestionAnswer & { value: string }
): RunQuestionView {
  const { runId, questionId, value, answeredBy } = args
  const subject = trustQuestionSubject(question)
  if (!subject) {
    throw notPending(`Trust question ${questionId} has no source to decide.`, { runId, questionId })
  }
  const state = db.getWorkflowRun(runId)?.state
  if (state === undefined || TERMINAL_RUN_STATES.has(state)) {
    throw new OrchestrationError('workflow_run_not_active', `Run ${runId} has already ended.`, {
      runId,
      questionId
    })
  }
  // Why before deciding: a late second answer must not overwrite the recorded trust decision.
  if (question.state !== 'pending' && question.state !== 'escalated') {
    throw notPending(`Trust question ${questionId} is no longer open (${question.state}).`, {
      runId,
      questionId
    })
  }
  if (value !== 'trusted' && value !== 'refused') {
    throw new OrchestrationError(
      'invalid_argument',
      'A trust question is answered with trusted or refused.',
      { runId, questionId }
    )
  }
  const runIds = decideSourceTrust(db, notifier, {
    host: subject.host,
    source: subject.source,
    decision: value,
    decidedBy: answeredBy
  })
  for (const answeredRunId of runIds) {
    wakeWorkflowRun(answeredRunId)
  }
  const answered = db.listWorkflowQuestions(runId).find((candidate) => candidate.id === questionId)
  if (answered?.state !== 'answered') {
    throw notPending(`Trust question ${questionId} was not answered.`, { runId, questionId })
  }
  return answered
}

/** Records the first authorised answer to one of the run's open questions (first answer wins). */
export function answerRunQuestion(
  db: OrchestrationDb,
  notifier: WorkflowRunChangeNotifier,
  args: RunQuestionAnswer
): RunQuestionView {
  const { runId, questionId, answeredBy } = args
  if (!db.getWorkflowRun(runId)) {
    throw new Error('workflow_not_found')
  }
  const question = db.listWorkflowQuestions(runId).find((candidate) => candidate.id === questionId)
  if (!question) {
    throw notPending(`Run ${runId} has no question ${questionId}.`, { runId, questionId })
  }
  // Why either field: an approval or trust choice is an option id, an agent question free text,
  // but a client may send a suggested agent option as optionId or a choice as plain text.
  const value =
    question.kind === 'agent-question'
      ? (args.answer ?? args.optionId)
      : (args.optionId ?? args.answer)
  if (value === undefined) {
    throw new OrchestrationError('invalid_argument', 'Pass an answer or an optionId.', {
      runId,
      questionId
    })
  }
  switch (question.kind) {
    case 'approval':
      return resolveApproval(db, notifier, { runId, questionId, optionId: value, answeredBy })
    case 'agent-question':
      return answerAgentQuestion(db, notifier, { runId, questionId, answer: value, answeredBy })
    case 'trust':
      return answerTrustQuestion(db, notifier, question, { ...args, value })
  }
}
