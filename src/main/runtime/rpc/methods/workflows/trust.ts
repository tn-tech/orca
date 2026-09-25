import { defineMethod } from '../../core'
import {
  WorkflowProposalAction,
  WorkflowTrustDecide
} from '../../../../../shared/rpc-contract/workflow-run-params'

// Why: skeletons for U10; later units (source trust, P3 proposals) replace each throw.
function notImplemented(): never {
  throw new Error('workflow_not_implemented')
}

export const WORKFLOW_TRUST_METHODS = [
  defineMethod({ name: 'workflow.trust.list', params: null, handler: notImplemented }),
  defineMethod({
    name: 'workflow.trust.decide',
    params: WorkflowTrustDecide,
    handler: notImplemented
  }),
  defineMethod({
    name: 'workflow.proposal.accept',
    params: WorkflowProposalAction,
    handler: notImplemented
  }),
  defineMethod({
    name: 'workflow.proposal.export',
    params: WorkflowProposalAction,
    handler: notImplemented
  })
]
