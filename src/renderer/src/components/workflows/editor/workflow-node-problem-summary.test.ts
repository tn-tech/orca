import { describe, expect, it } from 'vitest'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'
import { summarizeNodeProblems } from './workflow-node-problem-summary'

const definition: Workflow = {
  version: 1,
  name: 'wf',
  workspacePolicy: 'run-workspace',
  roles: {},
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    { id: 'end-1', type: 'end', title: 'Finish' }
  ],
  edges: [],
  layout: {}
}

function problem(patch: Partial<WorkflowProblem>): WorkflowProblem {
  return { code: 'graph_x', message: 'm', severity: 'error', ...patch }
}

describe('summarizeNodeProblems', () => {
  it('groups problems per node, an error outranking a warning, messages named by title', () => {
    const summary = summarizeNodeProblems(
      [
        problem({ nodeId: 'end-1', severity: 'warning', message: 'Heads up.' }),
        problem({ nodeId: 'end-1', message: 'Node "end-1" is not reachable from Start.' }),
        problem({ edgeId: 'edge-1', message: 'Edge only.' }),
        problem({ message: 'Workflow-level.' })
      ],
      definition
    )

    expect(summary).toEqual({
      'end-1': {
        severity: 'error',
        messages: ['Heads up.', 'Node "Finish" is not reachable from Start.']
      }
    })
  })

  it('keeps a warning-only node at warning severity', () => {
    expect(
      summarizeNodeProblems([problem({ nodeId: 'start', severity: 'warning' })], definition)
    ).toEqual({ start: { severity: 'warning', messages: ['m'] } })
  })

  it('lists identical messages once', () => {
    expect(
      summarizeNodeProblems(
        [problem({ nodeId: 'start', code: 'a' }), problem({ nodeId: 'start', code: 'b' })],
        definition
      )
    ).toEqual({ start: { severity: 'error', messages: ['m'] } })
  })
})
