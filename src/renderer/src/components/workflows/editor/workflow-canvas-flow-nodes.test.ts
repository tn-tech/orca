import { describe, expect, it } from 'vitest'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import { toFlowNodes } from './workflow-canvas-flow-nodes'

const definition: Workflow = {
  version: 1,
  name: 'wf',
  workspacePolicy: 'run-workspace',
  roles: {},
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    { id: 'end', type: 'end', title: 'End' }
  ],
  edges: [],
  layout: {}
}

describe('toFlowNodes', () => {
  it('hands each node its own problem summary for the inline indicator (F7)', () => {
    const problem = { severity: 'error' as const, messages: ['Not reachable.'] }

    const nodes = toFlowNodes(definition, {
      nodeProblems: { end: problem },
      selectedNodeId: undefined,
      parentOf: new Map()
    })

    expect(nodes.find((node) => node.id === 'end')?.data.problem).toEqual(problem)
    expect(nodes.find((node) => node.id === 'start')?.data.problem).toBeUndefined()
  })
})
