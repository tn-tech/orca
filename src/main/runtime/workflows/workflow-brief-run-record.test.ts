import { describe, expect, it } from 'vitest'
import type { NodeAttemptView } from '../../../shared/workflows/workflow-run-types'
import { buildRunRecord, RUN_RECORD_ATTEMPTS_PER_NODE } from './workflow-brief-run-record'
import { reflectionWorkflow } from './workflow-role-proposal-test-fixtures'

function attempt(nodeId: string, iteration: number): NodeAttemptView {
  return {
    id: `${nodeId}#${iteration}`,
    runId: 'wfr_1',
    nodeId,
    nodeType: 'agent',
    iteration,
    attemptIndex: 0,
    state: 'completed',
    artifactsJson: []
  }
}

describe('buildRunRecord', () => {
  it(`keeps only each node's latest ${RUN_RECORD_ATTEMPTS_PER_NODE} attempts, oldest first`, () => {
    const loopAttempts = Array.from({ length: RUN_RECORD_ATTEMPTS_PER_NODE + 2 }, (_, i) =>
      attempt('implement', i)
    )
    const record = buildRunRecord(
      reflectionWorkflow(),
      [attempt('plan', 0), ...loopAttempts, attempt('reflect', 0)],
      'reflect'
    )
    expect(record.map((entry) => `${entry.nodeId}#${entry.iteration}`)).toEqual([
      'plan#0',
      ...loopAttempts.slice(-RUN_RECORD_ATTEMPTS_PER_NODE).map((a) => a.id)
    ])
  })
})
