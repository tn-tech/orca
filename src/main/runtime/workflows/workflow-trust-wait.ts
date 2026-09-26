// A node whose plugin source is untrusted on its host waits instead of failing (FR-018a): the
// attempt goes provisioning -> waiting with a `trust` question pending, and the run shows
// `waiting` while any question is open. Other nodes keep running. Once the question is answered
// (workflow-source-trust.ts decideSourceTrust), the attempt is resumable: it re-enters the same
// dispatch path (provisioning, then worker start) from its persisted row, so a restarted runtime
// resumes it exactly as a live one would, and an unanswered one simply keeps waiting.
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import type { WorkflowRunRecorder } from './workflow-run-recorder'
import type { WorkflowSkillTrustQuestion } from './workflow-skill-provisioning'
import { LOCAL_TRUST_HOST, raiseTrustQuestion, trustQuestionSubject } from './workflow-source-trust'

export function enterTrustWait(
  db: OrchestrationDb,
  recorder: WorkflowRunRecorder,
  attemptId: string,
  question: WorkflowSkillTrustQuestion
): NodeAttemptView | undefined {
  const asked = raiseTrustQuestion(db, {
    runId: recorder.runId,
    attemptId,
    question: { ...question, host: question.host ?? LOCAL_TRUST_HOST }
  })
  const attempt = recorder.transitionAttempt(attemptId, 'waiting', {
    reason: 'trust',
    questionId: asked.id,
    source: question.source
  })
  recorder.event(
    'trust_question_raised',
    { questionId: asked.id, source: question.source, skills: question.skills },
    { attemptId, reason: 'question' }
  )
  if (db.getWorkflowRun(recorder.runId)?.state === 'running') {
    recorder.transitionRun('waiting', 'run_waiting', { reason: 'trust' })
  }
  return attempt
}

/** Waiting, never dispatched, and every trust question it raised has been answered. */
export function answeredTrustWaits(db: OrchestrationDb, runId: string): NodeAttemptView[] {
  const questions = db.listWorkflowQuestions(runId).filter((q) => trustQuestionSubject(q))
  return db.listWorkflowAttempts(runId).filter((attempt) => {
    if (attempt.state !== 'waiting' || attempt.dispatchId || !attempt.taskId) {
      return false
    }
    const own = questions.filter((question) => question.attemptId === attempt.id)
    return own.length > 0 && own.every((question) => question.state === 'answered')
  })
}

/** The run leaves `waiting` once nothing is left for a person to answer. */
export function leaveRunWaitIfClear(db: OrchestrationDb, recorder: WorkflowRunRecorder): void {
  if (
    db.getWorkflowRun(recorder.runId)?.state === 'waiting' &&
    db.listPendingWorkflowQuestions(recorder.runId).length === 0
  ) {
    recorder.transitionRun('running', 'run_resumed', { reason: 'questions_answered' })
  }
}
