import { z } from 'zod'
import { JsonValueSchema } from '../../../src/shared/workflows/workflow-condition-schema'
import { WORKFLOW_RUN_STATES } from '../../../src/shared/workflows/workflow-node-states'
import type {
  RunQuestionView,
  WorkflowQuestionKind,
  WorkflowQuestionState
} from '../../../src/shared/workflows/workflow-run-types'
import { openEnum, salvagingArray } from '../../../src/shared/zod-salvage'

// Reply schemas for the `workflow.run.*` reads mobile makes. Only the members the run list and
// prompt card render are kept; a newer host's extra members are stripped.

const QUESTION_KINDS = [
  'approval',
  'agent-question',
  'trust'
] as const satisfies readonly WorkflowQuestionKind[]
const QUESTION_STATES = [
  'pending',
  'answered',
  'escalated',
  'expired'
] as const satisfies readonly WorkflowQuestionState[]

// Why nullish: the host omits absent members today, but a null must not drop the whole row.
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)

const workflowRunSummarySchema = z.object({
  id: z.string().min(1),
  workflowName: z.string(),
  objective: z.string(),
  // Why undefined: a state a newer host adds is shown as unknown, never as a wrong known state.
  state: openEnum(WORKFLOW_RUN_STATES, undefined),
  createdAt: optionalText,
  startedAt: optionalText,
  finishedAt: optionalText
})

export type MobileWorkflowRunSummary = z.output<typeof workflowRunSummarySchema>

export const workflowRunListSchema = z.object({
  runs: salvagingArray(workflowRunSummarySchema)
})

const workflowQuestionSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  attemptId: z.string(),
  // Why undefined: an unknown kind or state is still shown (read-only) rather than dropped.
  kind: openEnum(QUESTION_KINDS, undefined),
  prompt: z.string(),
  optionsJson: JsonValueSchema.catch(null),
  state: openEnum(QUESTION_STATES, undefined),
  answer: optionalText,
  answeredBy: optionalText,
  answeredAt: optionalText,
  escalationAt: optionalText,
  timeoutAt: optionalText
})

export type MobileWorkflowQuestion = z.output<typeof workflowQuestionSchema>

/** A question whose kind and state this app knows, so the shared decoders can read it. */
export function isKnownWorkflowQuestion(
  question: MobileWorkflowQuestion
): question is MobileWorkflowQuestion & RunQuestionView {
  return question.kind !== undefined && question.state !== undefined
}

/** Still awaiting a person: an `escalated` question has notified but not hit its default yet. */
export function isAnswerableWorkflowQuestion(question: MobileWorkflowQuestion): boolean {
  return question.state === 'pending' || question.state === 'escalated'
}

export const workflowRunShowSchema = workflowRunSummarySchema.extend({
  questions: salvagingArray(workflowQuestionSchema)
})

export type MobileWorkflowRunSnapshot = z.output<typeof workflowRunShowSchema>

export const workflowRunAnswerSchema = z.object({
  state: openEnum(WORKFLOW_RUN_STATES, undefined)
})
