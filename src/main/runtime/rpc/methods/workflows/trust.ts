import { defineMethod } from '../../core'
import {
  WorkflowTrustDecide,
  WorkflowTrustRevoke
} from '../../../../../shared/rpc-contract/workflow-run-params'
import {
  decideSourceTrust,
  LOCAL_TRUST_HOST,
  listSourceTrustDecisions,
  revokeSourceTrust
} from '../../../workflows/workflow-source-trust'
import { wakeWorkflowRun } from '../../../workflows/workflow-run-wake'
import { workflowCallerIdentity } from './workflow-caller-identity'

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
    handler: (params, ctx) => {
      const { runtime } = ctx
      if (!params.decision) {
        throw new Error('Missing trust decision: pass trusted or refused')
      }
      const runIds = decideSourceTrust(runtime.getOrchestrationDb(), runtime, {
        host: params.host ?? LOCAL_TRUST_HOST,
        source: params.source,
        decision: params.decision,
        decidedBy: workflowCallerIdentity(ctx)
      })
      for (const runId of runIds) {
        wakeWorkflowRun(runId)
      }
      return {}
    }
  }),
  // FR-018a "revocable from settings": forgets the decision so the next run asks again, unlike
  // deciding `refused` (which fails the node instead). A no-op for a source with no decision.
  defineMethod({
    name: 'workflow.trust.revoke',
    params: WorkflowTrustRevoke,
    handler: (params, { runtime }) => {
      revokeSourceTrust(runtime.getOrchestrationDb(), {
        host: params.host ?? LOCAL_TRUST_HOST,
        source: params.source
      })
      return {}
    }
  })
]
