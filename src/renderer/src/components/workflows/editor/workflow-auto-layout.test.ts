import { describe, expect, it } from 'vitest'
import type {
  AgentNode,
  Edge,
  LoopNode,
  Node
} from '../../../../../shared/workflows/workflow-definition-types'
import {
  computeAutoLayout,
  computeLoopContainerBounds,
  measureWorkflowNodeSize,
  WORKFLOW_LOOP_PADDING,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH
} from './workflow-auto-layout'

function startNode(id: string): Node {
  return { id, type: 'start', title: 'Start' }
}

function endNode(id: string): Node {
  return { id, type: 'end', title: 'End' }
}

function agentNode(id: string, overrides?: AgentNode['overrides']): AgentNode {
  return {
    id,
    type: 'agent',
    title: id,
    prompt: 'do the thing',
    workspace: 'run',
    resultContract: { type: 'object' },
    artifacts: [],
    question: { timeoutMs: 1, escalationGraceMs: 1 },
    overrides
  }
}

function edge(id: string, from: string, to: string): Edge {
  return { id, from, to }
}

describe('computeAutoLayout', () => {
  it('lays out a linear chain left to right with increasing x', () => {
    const nodes = [startNode('start'), endNode('end')]
    const edges = [edge('e1', 'start', 'end')]

    const layout = computeAutoLayout(nodes, edges)

    expect(layout.start.x).toBeLessThan(layout.end.x)
  })

  it('separates connected nodes by at least the node width', () => {
    const nodes = [startNode('start'), endNode('end')]
    const edges = [edge('e1', 'start', 'end')]

    const layout = computeAutoLayout(nodes, edges)

    expect(layout.end.x - layout.start.x).toBeGreaterThanOrEqual(WORKFLOW_NODE_WIDTH)
  })

  it('restores a pinned position instead of the dagre-computed one', () => {
    const nodes = [startNode('start'), endNode('end')]
    const edges = [edge('e1', 'start', 'end')]

    const layout = computeAutoLayout(nodes, edges, { pinned: { start: { x: 999, y: 42 } } })

    expect(layout.start).toEqual({ x: 999, y: 42 })
    expect(layout.end).not.toEqual({ x: 999, y: 42 })
  })

  it('ignores an edge referencing a node outside the given node list', () => {
    const nodes = [startNode('start')]
    const edges = [edge('e1', 'start', 'missing')]

    expect(() => computeAutoLayout(nodes, edges)).not.toThrow()
    expect(computeAutoLayout(nodes, edges).start).toBeDefined()
  })

  it('returns a position for every node, even with no edges at all', () => {
    const nodes = [startNode('a'), startNode('b')]

    const layout = computeAutoLayout(nodes, [])

    expect(layout.a).toBeDefined()
    expect(layout.b).toBeDefined()
  })
})

describe('computeLoopContainerBounds', () => {
  it('fits a single body node plus padding on every side', () => {
    const bounds = computeLoopContainerBounds({ x: 0, y: 0 }, [{ x: 40, y: 40 }])

    expect(bounds).toEqual({
      width: 40 + WORKFLOW_NODE_WIDTH + WORKFLOW_LOOP_PADDING,
      height: 40 + WORKFLOW_NODE_HEIGHT + WORKFLOW_LOOP_PADDING
    })
  })

  it('grows to cover the furthest body node', () => {
    const bounds = computeLoopContainerBounds({ x: 0, y: 0 }, [
      { x: 40, y: 40 },
      { x: 300, y: 40 }
    ])

    expect(bounds.width).toBe(300 + WORKFLOW_NODE_WIDTH + WORKFLOW_LOOP_PADDING)
  })

  it('falls back to a single node box when the body is empty', () => {
    const bounds = computeLoopContainerBounds({ x: 0, y: 0 }, [])

    expect(bounds).toEqual({
      width: WORKFLOW_NODE_WIDTH + WORKFLOW_LOOP_PADDING * 2,
      height: WORKFLOW_NODE_HEIGHT + WORKFLOW_LOOP_PADDING * 2
    })
  })
})

describe('measureWorkflowNodeSize', () => {
  it('renders an Agent with no model at the base card height (F10 root cause: AgentNode.tsx:40)', () => {
    expect(measureWorkflowNodeSize(agentNode('a')).height).toBe(WORKFLOW_NODE_HEIGHT)
  })

  it('renders an Agent with overrides.model set taller than the base card height', () => {
    const size = measureWorkflowNodeSize(agentNode('a', { model: 'gpt-5.6-luna' }))
    expect(size.height).toBeGreaterThan(WORKFLOW_NODE_HEIGHT)
  })

  it('grows a Router with its choice count', () => {
    const oneChoice = measureWorkflowNodeSize({
      id: 'r',
      type: 'router',
      title: 'Router',
      prompt: 'choose',
      choices: ['Option 1']
    })
    const threeChoices = measureWorkflowNodeSize({
      id: 'r',
      type: 'router',
      title: 'Router',
      prompt: 'choose',
      choices: ['Option 1', 'Option 2', 'Option 3']
    })
    expect(threeChoices.height).toBeGreaterThan(oneChoice.height)
  })

  it('grows an Approval with its option count, and is taller than a Router with the same count', () => {
    const approval = measureWorkflowNodeSize({
      id: 'ap',
      type: 'approval',
      title: 'Approval',
      question: 'Approve?',
      options: ['Approve'],
      timeoutMs: 1,
      escalationGraceMs: 1
    })
    const router = measureWorkflowNodeSize({
      id: 'r',
      type: 'router',
      title: 'Router',
      prompt: 'choose',
      choices: ['Option 1']
    })
    // Approval always shows a timeout row alongside its question; Router doesn't have an
    // equivalent third row.
    expect(approval.height).toBeGreaterThan(router.height)
  })
})

describe('measureWorkflowNodeSize: pinned pixel estimates (F10 round 1 review, Important #3)', () => {
  it('pins a 6-choice Router at the corrected 30px-per-row pitch, not the old 28px one', () => {
    const size = measureWorkflowNodeSize({
      id: 'r',
      type: 'router',
      title: 'Router',
      prompt: 'choose',
      choices: ['1', '2', '3', '4', '5', '6']
    })
    expect(size.height).toBe(WORKFLOW_NODE_HEIGHT + 30 * 6)
  })

  it('pins a 5-option Approval at the corrected pitch plus its timeout row', () => {
    const size = measureWorkflowNodeSize({
      id: 'ap',
      type: 'approval',
      title: 'Approval',
      question: 'Approve?',
      options: ['1', '2', '3', '4', '5'],
      timeoutMs: 1,
      escalationGraceMs: 1
    })
    expect(size.height).toBe(WORKFLOW_NODE_HEIGHT + 18 + 30 * 5)
  })
})

describe('computeAutoLayout: measured sizes preferred over the estimate (F10 round 1 review, Important #3)', () => {
  function startLoopBody(): { nodes: Node[]; edges: Edge[] } {
    const start = startNode('start')
    const body = agentNode('body')
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
    return { nodes: [start, loop, body], edges: [edge('e1', 'start', 'loop')] }
  }

  it('sizes a Loop container from its body node measured size, not the estimate', () => {
    const { nodes, edges } = startLoopBody()
    // Far taller than measureWorkflowNodeSize would ever estimate for a model-less Agent — with
    // a single node per rank, dagre aligns "start" to whatever center its one successor ("loop")
    // ends up at, so a much taller Loop box (driven by this measured body size) visibly shifts
    // "start" instead of leaving it where the ~64px estimate would.
    const measuredSizes = new Map([['body', { width: 220, height: 500 }]])

    const withEstimate = computeAutoLayout(nodes, edges)
    const withMeasured = computeAutoLayout(nodes, edges, { measuredSizes })

    expect(Math.abs(withMeasured.start.y - withEstimate.start.y)).toBeGreaterThan(200)
  })

  it('falls back to the estimate for a node absent from measuredSizes', () => {
    const tall = agentNode('tall', { model: 'gpt-5.6-luna' })
    const nodes = [startNode('start'), tall]
    const edges = [edge('e1', 'start', 'tall')]

    const withoutOption = computeAutoLayout(nodes, edges)
    const withEmptyMeasured = computeAutoLayout(nodes, edges, { measuredSizes: new Map() })

    expect(withEmptyMeasured).toEqual(withoutOption)
  })
})

describe('computeAutoLayout: real per-kind sizes', () => {
  it('actually reserves a taller box for an Agent with a model set, not just the base estimate (F10 round 1 review, Minor #6 — the old flat-64px reservation moved "start" identically either way)', () => {
    const withModel = computeAutoLayout(
      [startNode('start'), agentNode('tall', { model: 'gpt-5.6-luna' })],
      [edge('e1', 'start', 'tall')]
    )
    const withoutModel = computeAutoLayout(
      [startNode('start'), agentNode('tall')],
      [edge('e1', 'start', 'tall')]
    )
    expect(withModel.start.y).not.toEqual(withoutModel.start.y)
  })

  it('gives an Agent with a model set enough vertical room not to overlap a sibling at the same rank', () => {
    const tall = agentNode('tall', { model: 'gpt-5.6-luna' })
    const short = agentNode('short')
    const nodes = [startNode('start'), tall, short]
    const edges = [edge('e1', 'start', 'tall'), edge('e2', 'start', 'short')]

    const layout = computeAutoLayout(nodes, edges)

    const tallBox = {
      top: layout.tall.y,
      bottom: layout.tall.y + measureWorkflowNodeSize(tall).height
    }
    const shortBox = {
      top: layout.short.y,
      bottom: layout.short.y + measureWorkflowNodeSize(short).height
    }
    const noOverlap = tallBox.bottom <= shortBox.top || shortBox.bottom <= tallBox.top
    expect(noOverlap).toBe(true)
  })
})

describe('computeAutoLayout: Loop containers (F10)', () => {
  function loopWrapping(id: string, bodyId: string): LoopNode {
    return {
      id,
      type: 'loop',
      title: 'Loop',
      body: { nodeIds: [bodyId] },
      entryNodeId: bodyId,
      exitNodeId: bodyId,
      maxIterations: 3,
      exitCondition: { path: 'approved', op: 'truthy' },
      onCapReached: 'fail'
    }
  }

  it('places the Loop body inside a container anchored at the Loop node final position', () => {
    const body = agentNode('body')
    const loop = loopWrapping('loop', 'body')
    const nodes = [startNode('start'), loop, body, endNode('end')]
    const edges = [edge('e1', 'start', 'loop'), edge('e2', 'body', 'end')]

    const layout = computeAutoLayout(nodes, edges)
    const bounds = computeLoopContainerBounds(layout.loop, [
      { ...layout.body, ...measureWorkflowNodeSize(body) }
    ])

    // The body sits inside the container's box, not off wherever an independent flat layout of
    // "body" (as if it were an ordinary top-level node with its own edges) would have put it.
    expect(layout.body.x).toBeGreaterThanOrEqual(layout.loop.x)
    expect(layout.body.y).toBeGreaterThanOrEqual(layout.loop.y)
    expect(layout.body.x + measureWorkflowNodeSize(body).width).toBeLessThanOrEqual(
      layout.loop.x + bounds.width
    )
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
  })

  it('does not overlap the Loop container with a sibling node dagre placed at the same rank', () => {
    const body = agentNode('body')
    const loop = loopWrapping('loop', 'body')
    const sibling = agentNode('sibling')
    const nodes = [startNode('start'), loop, body, sibling]
    const edges = [edge('e1', 'start', 'loop'), edge('e2', 'start', 'sibling')]

    const layout = computeAutoLayout(nodes, edges)
    const loopBounds = computeLoopContainerBounds(layout.loop, [
      { ...layout.body, ...measureWorkflowNodeSize(body) }
    ])
    const loopBox = { ...layout.loop, ...loopBounds }
    const siblingBox = { ...layout.sibling, ...measureWorkflowNodeSize(sibling) }

    const overlaps = !(
      loopBox.x + loopBox.width <= siblingBox.x ||
      siblingBox.x + siblingBox.width <= loopBox.x ||
      loopBox.y + loopBox.height <= siblingBox.y ||
      siblingBox.y + siblingBox.height <= loopBox.y
    )
    expect(overlaps).toBe(false)
  })

  it('carries a manually-dragged body node along with its (unpinned) Loop after Re-layout moves the Loop (F10 round 1 review, Important #2)', () => {
    const bodyA = agentNode('bodyA')
    const bodyB = agentNode('bodyB')
    const loop: LoopNode = {
      id: 'loop',
      type: 'loop',
      title: 'Loop',
      body: { nodeIds: ['bodyA', 'bodyB'] },
      entryNodeId: 'bodyA',
      exitNodeId: 'bodyB',
      maxIterations: 3,
      exitCondition: { path: 'approved', op: 'truthy' },
      onCapReached: 'fail'
    }
    const nodes = [startNode('start'), loop, bodyA, bodyB, endNode('end')]
    const edges = [
      edge('e1', 'start', 'loop'),
      edge('e2', 'bodyA', 'bodyB'),
      { id: 'e3', from: 'bodyB', to: 'end', fromPort: 'exit' }
    ]
    // The user dragged bodyA far from bodyB inside the Loop; the Loop itself was never dragged.
    const currentLayout = {
      start: { x: -300, y: 0 },
      loop: { x: 0, y: 0 },
      bodyA: { x: 500, y: 500 },
      bodyB: { x: 40, y: 40 },
      end: { x: 900, y: 0 }
    }

    const layout = computeAutoLayout(nodes, edges, {
      pinned: { bodyA: currentLayout.bodyA },
      currentLayout
    })

    // The Loop actually moved (otherwise this test proves nothing about the fix).
    expect(layout.loop).not.toEqual(currentLayout.loop)
    // bodyA's offset from the Loop is preserved, not its stale absolute position.
    const oldOffset = {
      x: currentLayout.bodyA.x - currentLayout.loop.x,
      y: currentLayout.bodyA.y - currentLayout.loop.y
    }
    const newOffset = { x: layout.bodyA.x - layout.loop.x, y: layout.bodyA.y - layout.loop.y }
    expect(newOffset).toEqual(oldOffset)
    // The container still contains both body nodes — no negative/detached frame.
    const bounds = computeLoopContainerBounds(layout.loop, [
      { ...layout.bodyA, ...measureWorkflowNodeSize(bodyA) },
      { ...layout.bodyB, ...measureWorkflowNodeSize(bodyB) }
    ])
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
  })
})
