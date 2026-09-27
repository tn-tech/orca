import { defineMethod } from '../../core'
import {
  WorkflowRunAnswer,
  WorkflowRunSendMessage
} from '../../../../../shared/rpc-contract/workflow-run-params'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import { queueFollowUp } from '../../../workflows/workflow-follow-up-delivery'
import { answerRunQuestion } from '../../../workflows/workflow-question-answer'
import { workflowCallerIdentity } from './workflow-caller-identity'

export const WORKFLOW_INTERACTION_METHODS = [
  defineMethod({
    name: 'workflow.run.answer',
    params: WorkflowRunAnswer,
    handler: (params, ctx) => {
      const { runtime } = ctx
      const db = runtime.getOrchestrationDb()
      answerRunQuestion(db, runtime, {
        runId: params.runId,
        questionId: params.questionId,
        ...(params.answer !== undefined ? { answer: params.answer } : {}),
        ...(params.optionId !== undefined ? { optionId: params.optionId } : {}),
        answeredBy: workflowCallerIdentity(ctx)
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
    handler: (params, ctx) => {
      const { runtime } = ctx
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
        sender: workflowCallerIdentity(ctx)
      })
      return { messageId: message.id }
    }
  })
]
