// Pure reads of an Approval attempt's `{ option }` result, shared by the frontier and the gates.
import type { JsonValue } from '../../../shared/workflows/workflow-condition-schema'
import type { Edge } from '../../../shared/workflows/workflow-definition-types'

export type ApprovalResult = { option: string }

export function readApprovalResult(value: JsonValue | undefined): ApprovalResult | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return typeof value.option === 'string' ? { option: value.option } : undefined
}

/** Whether a completed Approval's answer picked the port `edge` leaves from. */
export function approvalChoseEdge(edge: Edge, resultJson: JsonValue | undefined): boolean {
  return edge.fromPort !== undefined && readApprovalResult(resultJson)?.option === edge.fromPort
}
