import { defineMethod } from '../../core'
import {
  WorkflowProposalAction,
  WorkflowTrustDecide
} from '../../../../../shared/rpc-contract/workflow-run-params'
import {
  decideSourceTrust,
  LOCAL_TRUST_HOST,
  listSourceTrustDecisions
} from '../../../workflows/workflow-source-trust'
import { wakeWorkflowRun } from '../../../workflows/workflow-run-wake'

// Why: skeletons for U10; P3 proposals replace each throw.
function notImplemented(): never {
  throw new Error('workflow_not_implemented')
}

export const WORKFLOW_TRUST_METHODS = [
  defineMethod({
    name: 'workflow.trust.list',
    params: null,
    handler: (_params, { runtime }) => ({
      decisions: listSourceTrustDecisions(runtime.getOrchestrationDb())
    })
  }),
  // Also how a pending `trust` question is answered (FR-018a): every waiting node for this
  // source on this host resumes provisioning. Deciding again revokes an earlier decision.
  defineMethod({
    name: 'workflow.trust.decide',
    params: WorkflowTrustDecide,
    handler: (params, { runtime, clientId }) => {
      if (!params.decision) {
        throw new Error('Missing trust decision: pass trusted or refused')
      }
      const runIds = decideSourceTrust(runtime.getOrchestrationDb(), runtime, {
        host: params.host ?? LOCAL_TRUST_HOST,
        source: params.source,
        decision: params.decision,
        decidedBy: clientId ?? 'user'
      })
      for (const runId of runIds) {
        wakeWorkflowRun(runId)
      }
      return {}
    }
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
