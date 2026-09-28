import { describe, expect, it } from 'vitest'
import type {
  Edge,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { measureWorkflowNodeSize, WORKFLOW_LOOP_PADDING } from './workflow-auto-layout'
import { wrapNodesInLoopInDefinition } from './workflow-loop-commands'

function agentNode(id: string): Node {
  return {
    id,
    type: 'agent',
    title: id,
    prompt: 'do the thing',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1, escalationGraceMs: 1 }
  }
}

function workflow(nodes: Node[], edges: Edge[], layout: Workflow['layout']): Workflow {
  return {
    version: 1,
    name: 'test',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes,
    edges,
    layout
  }
}

describe('wrapNodesInLoopInDefinition', () => {
  it('does not overlap a neighbour left closer than WORKFLOW_LOOP_PADDING to the wrapped selection (F10 round 1 review, Important #4)', () => {
    const a = agentNode('a')
    const sibling = agentNode('sibling')
    const definition = workflow([a, sibling], [], {
      // Only 20px below "a"'s bottom edge — inside the 40px padding the Loop frame needs.
      a: { x: 0, y: 0 },
      sibling: { x: 0, y: measureWorkflowNodeSize(a).height + 20 }
    })

    const result = wrapNodesInLoopInDefinition(definition, ['a'])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const loopId = result.definition.nodes.find((node) => node.type === 'loop')?.id
    expect(loopId).toBeDefined()
    if (!loopId) {
      return
    }
    const loopPosition = result.definition.layout[loopId]
    const loopBottom =
      loopPosition.y + measureWorkflowNodeSize(a).height + WORKFLOW_LOOP_PADDING * 2
    const siblingPosition = result.definition.layout.sibling
    expect(siblingPosition.y).toBeGreaterThanOrEqual(loopBottom)
  })

  it('leaves a neighbour untouched when it is nowhere near the wrapped selection', () => {
    const a = agentNode('a')
    const sibling = agentNode('sibling')
    const definition = workflow([a, sibling], [], {
      a: { x: 0, y: 0 },
      sibling: { x: 2000, y: 2000 }
    })

    const result = wrapNodesInLoopInDefinition(definition, ['a'])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.definition.layout.sibling).toEqual({ x: 2000, y: 2000 })
    }
  })
})
