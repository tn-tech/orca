import { z } from 'zod'
import { WORKFLOW_RUN_STATES } from '../workflows/workflow-node-states'
import { WorkflowSource } from './workflow-params'
import { OptionalPositiveInt, OptionalString, requiredString } from './rpc-param-primitives'

const WorkflowRunOverrides = z
  .object({
    concurrencyLimit: z.number().int().positive().optional()
  })
  .strict()

export const WorkflowRunStart = z
  .object({
    repo: requiredString('Missing repo selector'),
    name: requiredString('Missing workflow name'),
    source: WorkflowSource.optional(),
    objective: OptionalString,
    overrides: WorkflowRunOverrides.optional()
  })
  .strict()

export const WorkflowRunList = z
  .object({
    repo: OptionalString,
    name: OptionalString,
    state: z.enum(WORKFLOW_RUN_STATES).optional(),
    cursor: OptionalString,
    limit: OptionalPositiveInt
  })
  .strict()

export const WorkflowRunShow = z
  .object({
    runId: requiredString('Missing run id')
  })
  .strict()

/** Shared by workflow.run.pause / .resume / .cancel — the action lives in the method name. */
export const WorkflowRunControl = z
  .object({
    runId: requiredString('Missing run id')
  })
  .strict()

export const WorkflowRunRerun = z
  .object({
    runId: requiredString('Missing run id'),
    fromNodeId: OptionalString
  })
  .strict()

export const WorkflowRunAnswer = z
  .object({
    runId: requiredString('Missing run id'),
    questionId: requiredString('Missing question id'),
    answer: OptionalString,
    optionId: OptionalString
  })
  .strict()

export const WorkflowRunSendMessage = z
  .object({
    runId: requiredString('Missing run id'),
    attemptId: requiredString('Missing attempt id'),
    text: OptionalString,
    mode: z.enum(['queued', 'interrupt']).optional()
  })
  .strict()

export const WorkflowRunReadNodeOutput = z
  .object({
    runId: requiredString('Missing run id'),
    attemptId: requiredString('Missing attempt id'),
    cursor: OptionalString,
    limit: OptionalPositiveInt
  })
  .strict()

export const WorkflowRunEvents = z
  .object({
    runId: requiredString('Missing run id'),
    afterSeq: OptionalPositiveInt,
    limit: OptionalPositiveInt
  })
  .strict()

export const WorkflowTrustDecide = z
  .object({
    source: requiredString('Missing trust source'),
    /** The execution host's trust key (`local`, `ssh:<id>`, `wsl:<distro>`); default `local`. */
    host: OptionalString,
    decision: z.enum(['trusted', 'refused']).optional()
  })
  .strict()

/** Forgets a source's decision on `host` (FR-018a revoke: back to "ask again"), as opposed to
 *  `workflow.trust.decide`'s `refused` (which fails the node instead of asking). A new method
 *  rather than a widened `decision` enum, so a host that predates it answers `method_not_found`
 *  instead of silently misinterpreting an unknown decision value. */
export const WorkflowTrustRevoke = z
  .object({
    source: requiredString('Missing trust source'),
    host: OptionalString
  })
  .strict()

/** Shared by workflow.proposal.accept / .export — both address one proposal on one run. */
export const WorkflowProposalAction = z
  .object({
    runId: requiredString('Missing run id'),
    proposalId: requiredString('Missing proposal id')
  })
  .strict()
