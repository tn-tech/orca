import { defineMethod } from '../../core'
import {
  WorkflowRunAnswer,
  WorkflowRunSendMessage
} from '../../../../../shared/rpc-contract/workflow-run-params'

// Why: skeletons for U10; the US1/US2 units replace each throw with the real question/mailbox logic.
function notImplemented(): never {
  throw new Error('workflow_not_implemented')
}

export const WORKFLOW_INTERACTION_METHODS = [
  defineMethod({
    name: 'workflow.run.answer',
    params: WorkflowRunAnswer,
    handler: notImplemented
  }),
  defineMethod({
    name: 'workflow.run.sendMessage',
    params: WorkflowRunSendMessage,
    handler: notImplemented
  })
]
