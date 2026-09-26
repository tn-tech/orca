import { describe, expect, it } from 'vitest'
import type { WorkflowProblem } from '../../../../../shared/workflows/workflow-definition-types'
import {
  hasBlockingWorkflowProblems,
  mergeWorkflowValidationProblems
} from './workflow-validation-merge'

function problem(patch: Partial<WorkflowProblem> = {}): WorkflowProblem {
  return { code: 'graph_cycle', message: 'cycle', severity: 'error', ...patch }
}

describe('mergeWorkflowValidationProblems', () => {
  it('returns host problems plus local problems the host list does not already carry', () => {
    const host = [problem({ code: 'graph_missing_end', message: 'no end' })]
    const local = [
      problem({ code: 'graph_missing_end', message: 'no end' }),
      problem({ code: 'graph_cycle', nodeId: 'a', message: 'cycle at a' })
    ]

    const merged = mergeWorkflowValidationProblems(local, host)

    expect(merged).toEqual([
      problem({ code: 'graph_missing_end', message: 'no end' }),
      problem({ code: 'graph_cycle', nodeId: 'a', message: 'cycle at a' })
    ])
  })

  it('drops local guesses for checks only the host can verify', () => {
    const local = [
      problem({ code: 'graph_skill_source_not_allowlisted', roleId: 'dev', message: 'not allowed' })
    ]

    const merged = mergeWorkflowValidationProblems(local, [])

    expect(merged).toEqual([])
  })

  it('keeps the host verdict for a skill-allowlist problem the host actually reports', () => {
    const host = [
      problem({ code: 'graph_skill_source_not_allowlisted', roleId: 'dev', message: 'not allowed' })
    ]

    const merged = mergeWorkflowValidationProblems([], host)

    expect(merged).toEqual(host)
  })

  it('treats problems at different locations as distinct even with the same code', () => {
    const local = [
      problem({ code: 'graph_cycle', nodeId: 'a' }),
      problem({ code: 'graph_cycle', nodeId: 'b' })
    ]

    const merged = mergeWorkflowValidationProblems(local, [])

    expect(merged).toHaveLength(2)
  })
})

describe('hasBlockingWorkflowProblems', () => {
  it('is true when any problem is severity error', () => {
    expect(hasBlockingWorkflowProblems([problem({ severity: 'warning' }), problem()])).toBe(true)
  })

  it('is false when every problem is a warning, or there are none', () => {
    expect(hasBlockingWorkflowProblems([problem({ severity: 'warning' })])).toBe(false)
    expect(hasBlockingWorkflowProblems([])).toBe(false)
  })
})
