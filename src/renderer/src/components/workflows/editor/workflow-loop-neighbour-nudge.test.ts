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
    expect(deltaY).not.toBe(0)
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

  it('clears an overlap below the Loop box when that is the shorter move', () => {
    const sibling = agentNode('sibling')
    // 90px from the loop's bottom, 10px from its top: clearing downward is shorter.
    const definition = workflow([sibling], [], { sibling: { x: 0, y: 90 } })
    const loopBox: Box = { x: 0, y: 0, width: 300, height: 100 }

    const next = nudgeOverlappingSiblings(definition, new Set(), loopBox)

    expect(next.sibling.y).toBe(loopBox.y + loopBox.height + WORKFLOW_LOOP_PADDING)
  })

  it('clears an overlap above the Loop box when that is the shorter move (Minor: neighbours overlapping from above)', () => {
    const sibling = agentNode('sibling')
    // 10px from the loop's top, 90px from its bottom: clearing upward is shorter.
    const definition = workflow([sibling], [], { sibling: { x: 0, y: 10 } })
    const loopBox: Box = { x: 0, y: 0, width: 300, height: 100 }

    const next = nudgeOverlappingSiblings(definition, new Set(), loopBox)

    expect(next.sibling.y).toBe(
      loopBox.y - WORKFLOW_LOOP_PADDING - measureWorkflowNodeSize(sibling).height
    )
  })

  it('keeps sliding a nudged sibling past another node it would otherwise land on (Minor: re-check pushed nodes)', () => {
    const sibling = agentNode('sibling')
    const blocker = agentNode('blocker')
    const loopBox: Box = { x: 0, y: 0, width: 300, height: 100 }
    const belowLoop = loopBox.y + loopBox.height + WORKFLOW_LOOP_PADDING
    const definition = workflow([sibling, blocker], [], {
      // Overlaps the loop and would land exactly on "blocker" if nudged only once.
      sibling: { x: 0, y: 90 },
      blocker: { x: 0, y: belowLoop }
    })

    const next = nudgeOverlappingSiblings(definition, new Set(), loopBox)

    const siblingBox = { ...next.sibling, ...measureWorkflowNodeSize(sibling) }
    const blockerBox = { ...next.blocker, ...measureWorkflowNodeSize(blocker) }
    const overlapsBlocker = !(
      siblingBox.x + siblingBox.width <= blockerBox.x ||
      blockerBox.x + blockerBox.width <= siblingBox.x ||
      siblingBox.y + siblingBox.height <= blockerBox.y ||
      blockerBox.y + blockerBox.height <= siblingBox.y
    )
    expect(overlapsBlocker).toBe(false)
    expect(next.blocker).toEqual({ x: 0, y: belowLoop })
  })
})
