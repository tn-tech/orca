import { defineMethod } from '../../core'
import {
  WorkflowDelete,
  WorkflowDraft,
  WorkflowDuplicate,
  WorkflowImportRole,
  WorkflowList,
  WorkflowRead,
  WorkflowValidate,
  WorkflowWrite
} from '../../../../../shared/rpc-contract/workflow-params'

// Why: skeletons for U10; U10.5/US1/P3 units replace each throw with the real implementation.
function notImplemented(): never {
  throw new Error('workflow_not_implemented')
}

export const WORKFLOW_DEFINITION_METHODS = [
  defineMethod({ name: 'workflow.list', params: WorkflowList, handler: notImplemented }),
  defineMethod({ name: 'workflow.read', params: WorkflowRead, handler: notImplemented }),
  defineMethod({ name: 'workflow.write', params: WorkflowWrite, handler: notImplemented }),
  defineMethod({ name: 'workflow.validate', params: WorkflowValidate, handler: notImplemented }),
  defineMethod({ name: 'workflow.delete', params: WorkflowDelete, handler: notImplemented }),
  defineMethod({
    name: 'workflow.duplicate',
    params: WorkflowDuplicate,
    handler: notImplemented
  }),
  defineMethod({
    name: 'workflow.importRole',
    params: WorkflowImportRole,
    handler: notImplemented
  }),
  defineMethod({ name: 'workflow.draft', params: WorkflowDraft, handler: notImplemented })
]
