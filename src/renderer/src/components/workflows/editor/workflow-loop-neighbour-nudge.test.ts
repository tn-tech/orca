import { describe, expect, it } from 'vitest'
import type {
  Edge,
  LoopNode,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { measureWorkflowNodeSize, WORKFLOW_LOOP_PADDING } from './workflow-auto-layout'
import { nodeBox, nudgeOverlappingSiblings, type Box } from './workflow-loop-neighbour-nudge'

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

describe('nodeBox', () => {
  it('sizes a Loop sibling from its own body, not the base card', () => {
    const bodyAgent = agentNode('body')
    const loop: LoopNode = {
      id: 'loop',
      type: 'loop',
      title: 'Loop',
      body: { nodeIds: ['body'] },
      entryNodeId: 'body',
      exitNodeId: 'body',
      maxIterations: 3,
      exitCondition: { path: 'approved', op: 'truthy' },
      onCapReached: 'fail'
    }
    const layout = { loop: { x: 0, y: 0 }, body: { x: 40, y: 40 } }

    const box = nodeBox(loop, layout)

    expect(box.height).toBeGreaterThan(measureWorkflowNodeSize(bodyAgent).height)
  })
})

describe('nudgeOverlappingSiblings', () => {
  it('moves a Loop sibling body with it, not just its own container position', () => {
    const siblingBody = agentNode('siblingBody')
    const siblingLoop: LoopNode = {
      id: 'siblingLoop',
      type: 'loop',
      title: 'Sibling Loop',
      body: { nodeIds: ['siblingBody'] },
      entryNodeId: 'siblingBody',
      exitNodeId: 'siblingBody',
      maxIterations: 3,
      exitCondition: { path: 'approved', op: 'truthy' },
      onCapReached: 'fail'
    }
    const definition = workflow([siblingLoop, siblingBody], [], {
      siblingLoop: { x: 0, y: 0 },
      siblingBody: { x: 40, y: 40 }
    })
    const loopBox: Box = { x: -10, y: -10, width: 300, height: 300 }

    const next = nudgeOverlappingSiblings(definition, new Set(), loopBox)

    const deltaY = next.siblingLoop.y - definition.layout.siblingLoop.y
    expect(deltaY).toBeGreaterThan(0)
    expect(next.siblingBody).toEqual({
      x: definition.layout.siblingBody.x,
      y: definition.layout.siblingBody.y + deltaY
    })
  })

  it('never moves a wrapped node itself', () => {
    const a = agentNode('a')
    const definition = workflow([a], [], { a: { x: 0, y: 0 } })
    const loopBox: Box = { x: -10, y: -10, width: 300, height: 300 }

    const next = nudgeOverlappingSiblings(definition, new Set(['a']), loopBox)

    expect(next.a).toEqual({ x: 0, y: 0 })
  })

  it('leaves a non-overlapping sibling untouched', () => {
    const sibling = agentNode('sibling')
    const definition = workflow([sibling], [], { sibling: { x: 5000, y: 5000 } })
    const loopBox: Box = { x: 0, y: 0, width: 300, height: 300 }

    const next = nudgeOverlappingSiblings(definition, new Set(), loopBox)

    expect(next.sibling).toEqual({ x: 5000, y: 5000 })
  })

  it('clears the overlap by WORKFLOW_LOOP_PADDING below the Loop box', () => {
    const sibling = agentNode('sibling')
    const definition = workflow([sibling], [], { sibling: { x: 0, y: 10 } })
    const loopBox: Box = { x: 0, y: 0, width: 300, height: 100 }

    const next = nudgeOverlappingSiblings(definition, new Set(), loopBox)

    expect(next.sibling.y).toBe(loopBox.y + loopBox.height + WORKFLOW_LOOP_PADDING)
  })
})
