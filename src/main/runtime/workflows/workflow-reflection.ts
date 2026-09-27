// Reflection node (US7, FR-034): an agent reviews the run and proposes role changes. Fixed result
// contract `{ proposals: [{ roleId, change: { systemPrompt?, skills? }, evidence }] }`; a proposal
// for a role the workflow lacks, or one that changes nothing, fails the node.
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { ResultContract, Workflow } from '../../../shared/workflows/workflow-definition-types'
import {
  RoleProposalSchema,
  type RoleProposal
} from '../../../shared/workflows/workflow-role-proposal-schema'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import type { OrchestrationDb } from '../orchestration/db'
import {
  captureNodeResult,
  type CaptureResultArgs,
  type CaptureResultOutcome
} from './workflow-result-capture'
import type { WorkflowRunRecorder } from './workflow-run-recorder'

const SKILL_REFERENCE_CONTRACT = {
  type: 'object',
  required: ['name', 'source'],
  properties: {
    name: { type: 'string', minLength: 1 },
    source: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { type: 'string', enum: ['plugin', 'repository'] },
        plugin: { type: 'string' },
        location: { type: 'string' },
        version: { type: 'string' }
      }
    },
    required: { type: 'boolean' }
  }
} as const

/** The fixed shape every Reflection result has (contracts/agent-brief.md). */
export const REFLECTION_RESULT_CONTRACT = {
  type: 'object',
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['roleId', 'change', 'evidence'],
        properties: {
          roleId: { type: 'string', minLength: 1 },
          change: {
            type: 'object',
            properties: {
              systemPrompt: { type: 'string', minLength: 1 },
              skills: { type: 'array', items: SKILL_REFERENCE_CONTRACT }
            }
          },
          evidence: { type: 'string', minLength: 1 }
        }
      }
    }
  }
} as const satisfies ResultContract

/** How the brief tells the agent which roles it may change and what a change means. */
export function reflectionProposalLines(roles: Workflow['roles']): string[] {
  const roleIds = Object.keys(roles)
  return [
    roleIds.length > 0
      ? 'Propose changes only to these roles (set `roleId` to one of them):'
      : 'This workflow has no roles to change: return an empty `proposals` list.',
    '',
    ...roleIds.map((roleId) => `- ${JSON.stringify(roleId)}`),
    '',
    "Each `change` replaces the role's value whole: `systemPrompt` is the complete new system " +
      'prompt and `skills` the complete new skills list. Set at least one of them, and cite in ' +
      '`evidence` what in this run supports the change.',
    ''
  ]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ProposalsRead = { ok: true; proposals: RoleProposal[] } | { ok: false; detail: string }

/** Reads a contract-valid result's proposals exactly, against the workflow's roles. */
export function readReflectionProposals(
  result: JsonValue | undefined,
  roles: Workflow['roles']
): ProposalsRead {
  const raw = isPlainObject(result) && Array.isArray(result.proposals) ? result.proposals : []
  const proposals: RoleProposal[] = []
  for (const [index, entry] of raw.entries()) {
    const parsed = RoleProposalSchema.safeParse(entry)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return {
        ok: false,
        detail: `proposals[${index}]: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim()
      }
    }
    const proposal = parsed.data
    if (!Object.hasOwn(roles, proposal.roleId)) {
      return {
        ok: false,
        detail: `proposals[${index}]: role ${JSON.stringify(proposal.roleId)} is not one of ${JSON.stringify(Object.keys(roles))}`
      }
    }
    if (proposal.change.systemPrompt === undefined && proposal.change.skills === undefined) {
      return {
        ok: false,
        detail: `proposals[${index}]: change sets neither systemPrompt nor skills`
      }
    }
    proposals.push(proposal)
  }
  return { ok: true, proposals }
}

/**
 * Captures against the fixed contract, then rejects an unknown role or an empty change as
 * `result_invalid`, keeping the result so the run view shows what the agent answered.
 */
export async function captureReflectionResult(
  roles: Workflow['roles'],
  args: Omit<CaptureResultArgs, 'resultContract'>
): Promise<CaptureResultOutcome> {
  const capture = await captureNodeResult({ ...args, resultContract: REFLECTION_RESULT_CONTRACT })
  if (!capture.ok) {
    return capture
  }
  const read = readReflectionProposals(capture.result, roles)
  if (read.ok) {
    return capture
  }
  return {
    ok: false,
    failureReason: 'result_invalid',
    detail: read.detail,
    result: capture.result,
    artifacts: capture.artifacts
  }
}

/** Attaches a completed Reflection's proposals to its run (US7 AS1). Replays store nothing new. */
export function recordReflectionProposals(
  db: OrchestrationDb,
  recorder: WorkflowRunRecorder,
  attempt: Pick<NodeAttemptView, 'id'>,
  result: JsonValue,
  roles: Workflow['roles']
): void {
  const read = readReflectionProposals(result, roles)
  if (!read.ok) {
    return
  }
  const stored = db.recordWorkflowRoleProposals(recorder.runId, attempt.id, read.proposals)
  recorder.event(
    'role_proposals_recorded',
    { proposalIds: stored.map((proposal) => proposal.id) },
    { attemptId: attempt.id, reason: 'attempt' }
  )
}
