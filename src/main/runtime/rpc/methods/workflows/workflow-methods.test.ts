import { describe, expect, it } from 'vitest'
import { eraseRpcMethods } from '../../core'
import { WORKFLOW_METHODS } from './index'
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
import {
  WorkflowProposalAction,
  WorkflowRunAnswer,
  WorkflowRunControl,
  WorkflowRunEvents,
  WorkflowRunList,
  WorkflowRunReadNodeOutput,
  WorkflowRunRerun,
  WorkflowRunSendMessage,
  WorkflowRunShow,
  WorkflowRunStart,
  WorkflowTrustDecide
} from '../../../../../shared/rpc-contract/workflow-run-params'

// Every workflow.* row in specs/001-visual-dag-workflows/contracts/rpc-methods.md, paired with
// the shared schema object contracts/rpc-methods.md says owns its params.
const CONTRACT_METHODS: readonly (readonly [string, unknown])[] = [
  ['workflow.list', WorkflowList],
  ['workflow.read', WorkflowRead],
  ['workflow.write', WorkflowWrite],
  ['workflow.validate', WorkflowValidate],
  ['workflow.delete', WorkflowDelete],
  ['workflow.duplicate', WorkflowDuplicate],
  ['workflow.importRole', WorkflowImportRole],
  ['workflow.draft', WorkflowDraft],
  ['workflow.run.start', WorkflowRunStart],
  ['workflow.run.list', WorkflowRunList],
  ['workflow.run.show', WorkflowRunShow],
  ['workflow.run.pause', WorkflowRunControl],
  ['workflow.run.resume', WorkflowRunControl],
  ['workflow.run.cancel', WorkflowRunControl],
  ['workflow.run.rerun', WorkflowRunRerun],
  ['workflow.run.answer', WorkflowRunAnswer],
  ['workflow.run.sendMessage', WorkflowRunSendMessage],
  ['workflow.run.readNodeOutput', WorkflowRunReadNodeOutput],
  ['workflow.run.events', WorkflowRunEvents],
  ['workflow.trust.list', null],
  ['workflow.trust.decide', WorkflowTrustDecide],
  ['workflow.proposal.accept', WorkflowProposalAction],
  ['workflow.proposal.export', WorkflowProposalAction]
]

describe('workflow RPC method registration', () => {
  it('registers exactly the contract methods, non-streaming, with no duplicates', () => {
    const erased = eraseRpcMethods(WORKFLOW_METHODS)
    expect(erased).toHaveLength(CONTRACT_METHODS.length)
    expect(new Set(erased.map((method) => method.name)).size).toBe(CONTRACT_METHODS.length)
    for (const method of erased) {
      expect('stream' in method, method.name).toBe(false)
    }
  })

  it.each(CONTRACT_METHODS)('binds %s to its shared params schema', (name, schema) => {
    const found = eraseRpcMethods(WORKFLOW_METHODS).find((candidate) => candidate.name === name)
    expect(found, `${String(name)} is not registered`).toBeDefined()
    expect(found?.params).toBe(schema)
  })
})
