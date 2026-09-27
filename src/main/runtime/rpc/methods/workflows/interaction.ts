import { defineMethod } from '../../core'
import {
  WorkflowRunAnswer,
  WorkflowRunSendMessage
} from '../../../../../shared/rpc-contract/workflow-run-params'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import { queueFollowUp } from '../../../workflows/workflow-follow-up-delivery'
import { answerRunQuestion } from '../../../workflows/workflow-question-answer'

/** Who answered or sent, as recorded on the run: the calling client, as `workflow.trust.decide` does. */
function callerIdentity(clientId: string | undefined): string {
  return clientId ?? 'user'
}

export const WORKFLOW_INTERACTION_METHODS = [
  defineMethod({
    name: 'workflow.run.answer',
    params: WorkflowRunAnswer,
    handler: (params, { runtime, clientId }) => {
      const db = runtime.getOrchestrationDb()
      answerRunQuestion(db, runtime, {
        runId: params.runId,
        questionId: params.questionId,
        ...(params.answer !== undefined ? { answer: params.answer } : {}),
        ...(params.optionId !== undefined ? { optionId: params.optionId } : {}),
        answeredBy: callerIdentity(clientId)
      })
      const run = db.getWorkflowRun(params.runId)
      if (!run) {
        throw new Error('workflow_not_found')
      }
      return { state: run.state }
    }
  }),
  defineMethod({
    name: 'workflow.run.sendMessage',
    params: WorkflowRunSendMessage,
    handler: (params, { runtime, clientId }) => {
      if (params.text === undefined) {
        throw new OrchestrationError('invalid_argument', 'Missing follow-up text.', {
          runId: params.runId,
          attemptId: params.attemptId
        })
      }
      const message = queueFollowUp(runtime.getOrchestrationDb(), runtime, {
        runId: params.runId,
        attemptId: params.attemptId,
        text: params.text,
        mode: params.mode ?? 'queued',
        sender: callerIdentity(clientId)
      })
      return { messageId: message.id }
    }
  })
]
