import { defineMethod } from '../../core'
import {
  WorkflowProposalAction,
  WorkflowRunAnswer,
  WorkflowRunSendMessage
} from '../../../../../shared/rpc-contract/workflow-run-params'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import { queueFollowUp } from '../../../workflows/workflow-follow-up-delivery'
import { answerRunQuestion } from '../../../workflows/workflow-question-answer'
import { acceptRoleProposal, exportRoleProposal } from '../../../workflows/workflow-role-proposals'
import { workflowCallerIdentity } from './workflow-caller-identity'
import { roleProposalPorts } from './workflow-proposal-ports'

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
  }),
  // US7 AS2: the accepted change lands in the workflow file and on the run that proposed it.
  defineMethod({
    name: 'workflow.proposal.accept',
    params: WorkflowProposalAction,
    handler: (params, ctx) =>
      acceptRoleProposal(roleProposalPorts(ctx.runtime), {
        runId: params.runId,
        proposalId: params.proposalId,
        actor: workflowCallerIdentity(ctx)
      })
  }),
  // US7 AS3: a change bundle for the role's origin repository, written in the run workspace.
  defineMethod({
    name: 'workflow.proposal.export',
    params: WorkflowProposalAction,
    handler: (params, ctx) =>
      exportRoleProposal(roleProposalPorts(ctx.runtime), {
        runId: params.runId,
        proposalId: params.proposalId,
        actor: workflowCallerIdentity(ctx)
      })
  })
]
