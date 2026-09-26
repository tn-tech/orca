// Router node (US3 AS6–AS7, FR-023, FR-029): the only language-model decision in the control path.
// Fixed result contract `{ choice, reason }`; a completed Router fires only the edge whose
// `fromPort` is its choice, and a choice outside `node.choices` fails the node.
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type {
  Edge,
  ResultContract,
  RouterNode
} from '../../../shared/workflows/workflow-definition-types'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import {
  captureNodeResult,
  type CaptureResultArgs,
  type CaptureResultOutcome
} from './workflow-result-capture'
import type { WorkflowRunRecorder } from './workflow-run-recorder'

export type RouterResult = { choice: string; reason: string }

/** The fixed shape every Router result has, whatever its choices. */
export const ROUTER_RESULT_CONTRACT = {
  type: 'object',
  required: ['choice', 'reason'],
  properties: { choice: { type: 'string' }, reason: { type: 'string' } }
} as const satisfies ResultContract

/** The fixed contract narrowed to this Router's choices, as its brief shows it. */
export function routerResultContract(node: RouterNode): ResultContract {
  const { properties } = ROUTER_RESULT_CONTRACT
  return {
    ...ROUTER_RESULT_CONTRACT,
    properties: { ...properties, choice: { ...properties.choice, enum: node.choices } }
  }
}

/** JSON-quoted so the worker can copy each choice into result.json exactly. */
export function routerChoiceLines(node: RouterNode): string[] {
  return [
    'Set `choice` to exactly one of these choices:',
    '',
    ...node.choices.map((choice) => `- ${JSON.stringify(choice)}`),
    ''
  ]
}

export function readRouterResult(value: JsonValue | undefined): RouterResult | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const { choice, reason } = value
  return typeof choice === 'string' && typeof reason === 'string' ? { choice, reason } : undefined
}

/** Whether a completed Router's result picked the port `edge` leaves from. */
export function routerChoseEdge(edge: Edge, resultJson: JsonValue | undefined): boolean {
  return edge.fromPort !== undefined && readRouterResult(resultJson)?.choice === edge.fromPort
}

/**
 * Captures against the fixed contract, then rejects a choice outside `node.choices` as
 * `result_invalid`, keeping the result so the run view shows what the agent answered (US3 AS7).
 */
export async function captureRouterResult(
  node: RouterNode,
  args: Omit<CaptureResultArgs, 'resultContract'>
): Promise<CaptureResultOutcome> {
  const capture = await captureNodeResult({ ...args, resultContract: ROUTER_RESULT_CONTRACT })
  const routed = readRouterResult(capture.result)
  if (routed && !node.choices.includes(routed.choice)) {
    return {
      ok: false,
      failureReason: 'result_invalid',
      result: capture.result,
      ...(capture.artifacts ? { artifacts: capture.artifacts } : {})
    }
  }
  return capture
}

/** Appends the accepted choice and its reason to workflow_run_events (FR-029). */
export function recordRouterChoice(
  recorder: WorkflowRunRecorder,
  attempt: Pick<NodeAttemptView, 'id' | 'nodeId' | 'iteration'>,
  result: JsonValue
): void {
  const routed = readRouterResult(result)
  if (routed) {
    recorder.event(
      'router_choice',
      { nodeId: attempt.nodeId, iteration: attempt.iteration, ...routed },
      { attemptId: attempt.id, reason: 'attempt' }
    )
  }
}
