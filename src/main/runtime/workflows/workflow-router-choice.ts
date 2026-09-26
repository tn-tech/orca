// Pure reads of a Router's `{ choice, reason }` result, shared by the frontier and Router capture.
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { Edge } from '../../../shared/workflows/workflow-definition-types'

export type RouterResult = { choice: string; reason: string }

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
