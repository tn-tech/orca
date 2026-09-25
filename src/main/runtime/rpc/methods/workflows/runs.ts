import { defineMethod } from '../../core'
import {
  WorkflowRunControl,
  WorkflowRunEvents,
  WorkflowRunList,
  WorkflowRunReadNodeOutput,
  WorkflowRunRerun,
  WorkflowRunShow,
  WorkflowRunStart
} from '../../../../../shared/rpc-contract/workflow-run-params'

// Why: skeletons for U10; the US1 unit replaces each throw with the workflow engine call.
function notImplemented(): never {
  throw new Error('workflow_not_implemented')
}

export const WORKFLOW_RUN_METHODS = [
  defineMethod({ name: 'workflow.run.start', params: WorkflowRunStart, handler: notImplemented }),
  defineMethod({ name: 'workflow.run.list', params: WorkflowRunList, handler: notImplemented }),
  defineMethod({ name: 'workflow.run.show', params: WorkflowRunShow, handler: notImplemented }),
  defineMethod({
    name: 'workflow.run.pause',
    params: WorkflowRunControl,
    handler: notImplemented
  }),
  defineMethod({
    name: 'workflow.run.resume',
    params: WorkflowRunControl,
    handler: notImplemented
  }),
  defineMethod({
    name: 'workflow.run.cancel',
    params: WorkflowRunControl,
    handler: notImplemented
  }),
  defineMethod({ name: 'workflow.run.rerun', params: WorkflowRunRerun, handler: notImplemented }),
  defineMethod({
    name: 'workflow.run.readNodeOutput',
    params: WorkflowRunReadNodeOutput,
    handler: notImplemented
  }),
  defineMethod({ name: 'workflow.run.events', params: WorkflowRunEvents, handler: notImplemented })
]
