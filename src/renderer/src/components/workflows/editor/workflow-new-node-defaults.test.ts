// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type {
  LoopNode,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { validateWorkflowGraph } from '../../../../../shared/workflows/workflow-graph-validation'
import { computeLoopContainerBounds } from './workflow-auto-layout'
import {
  ADDABLE_NODE_KINDS,
  createDefaultNode,
  freeNodePosition
} from './workflow-new-node-defaults'

const permissiveContext = { agentSupportsModel: () => true, allowlistedSources: [] }

/** Narrows `node` by its own `type` without a type assertion — an `it.each`-style helper would
 *  still need one at the call site, so this asserts the discriminant instead. */
function expectNodeType<T extends Node['type']>(
  node: Node,
  type: T
): asserts node is Extract<Node, { type: T }> {
  expect(node.type).toBe(type)
}

function emptyWorkflow(): Workflow {
  return {
    version: 1,
    name: 'test-workflow',
    workspacePolicy: 'run-workspace',
    roles: {},
    nodes: [],
    edges: [],
    layout: {}
  }
}

describe('ADDABLE_NODE_KINDS', () => {
  it('excludes loop (data-model.md: entry/exit/body have no editing UI, only wrap-in-loop creates one)', () => {
    expect(ADDABLE_NODE_KINDS).not.toContain('loop')
  })

  it('covers every other node kind the canvas can render', () => {
    expect([...ADDABLE_NODE_KINDS].sort()).toEqual(
      ['agent', 'approval', 'end', 'join', 'reflection', 'router', 'start'].sort()
    )
  })
})

describe('createDefaultNode', () => {
  it('gives every node a unique id prefixed by its kind', () => {
    const a = createDefaultNode('agent')
    const b = createDefaultNode('agent')
    expect(a.id).not.toEqual(b.id)
    expect(a.id.startsWith('agent-')).toBe(true)
  })

  it('builds a Start node with just a title', () => {
    const node = createDefaultNode('start')
    expectNodeType(node, 'start')
    expect(node.title.length).toBeGreaterThan(0)
  })

  it('builds an End node with just a title', () => {
    const node = createDefaultNode('end')
    expectNodeType(node, 'end')
    expect(node.title.length).toBeGreaterThan(0)
  })

  it('builds an Agent node with a non-empty prompt, run workspace, and a valid result contract', () => {
    const node = createDefaultNode('agent')
    expectNodeType(node, 'agent')
    expect(node.prompt.length).toBeGreaterThan(0)
    expect(node.workspace).toBe('run')
    expect(node.resultContract).toEqual({ type: 'object' })
    expect(node.artifacts).toEqual([])
    expect(node.question.timeoutMs).toBeGreaterThan(0)
    expect(node.question.escalationGraceMs).toBeGreaterThan(0)
    expect(node.roleId).toBeUndefined()
  })

  it('builds a Router node with a non-empty prompt and at least one choice', () => {
    const node = createDefaultNode('router')
    expectNodeType(node, 'router')
    expect(node.prompt.length).toBeGreaterThan(0)
    expect(node.choices.length).toBeGreaterThanOrEqual(1)
    expect(node.choices.every((choice) => choice.length > 0)).toBe(true)
  })

  it('builds a Join node waiting for all branches by default', () => {
    const node = createDefaultNode('join')
    expectNodeType(node, 'join')
    expect(node.policy).toBe('all')
    expect(node.onFailure).toBe('fail')
  })

  it('builds an Approval node with a question, at least one option, and positive timeouts', () => {
    const node = createDefaultNode('approval')
    expectNodeType(node, 'approval')
    expect(node.question.length).toBeGreaterThan(0)
    expect(node.options.length).toBeGreaterThanOrEqual(1)
    expect(node.timeoutMs).toBeGreaterThan(0)
    expect(node.escalationGraceMs).toBeGreaterThan(0)
  })

  it('builds a Reflection node with a non-empty prompt', () => {
    const node = createDefaultNode('reflection')
    expectNodeType(node, 'reflection')
    expect(node.prompt.length).toBeGreaterThan(0)
  })

  it('produces a node that, once connected, adds no structural graph problems beyond its kind', () => {
    // A freshly created, still-disconnected node is only ever flagged as unreachable — every
    // other required field already has a real value.
    for (const kind of ADDABLE_NODE_KINDS) {
      if (kind === 'start') {
        continue // exactly one Start already exists in a real workflow; adding a second one
        // is a distinct, expected problem (graph_multiple_start_nodes) covered by AddNodeMenu's
        // own exclusion, not this factory.
      }
      const node = createDefaultNode(kind)
      const definition: Workflow = {
        ...emptyWorkflow(),
        nodes: [{ id: 'start', type: 'start', title: 'Start' }, node],
        edges: [{ id: 'e1', from: 'start', to: node.id }]
      }
      const problems = validateWorkflowGraph(definition, permissiveContext)
      const codes = problems.map((problem) => problem.code)
      expect(codes).not.toContain('graph_unreachable_node')
      expect(codes).not.toContain('graph_unknown_role')
      expect(codes).not.toContain('graph_model_override_not_supported')
    }
  })
})

function loopNode(id: string, bodyNodeIds: string[]): LoopNode {
  return {
    id,
    type: 'loop',
    title: 'Loop',
    body: { nodeIds: bodyNodeIds },
    entryNodeId: bodyNodeIds[0]!,
    exitNodeId: bodyNodeIds.at(-1)!,
    maxIterations: 3,
    exitCondition: { path: 'approved', op: 'truthy' },
    onCapReached: 'fail'
  }
}

describe('freeNodePosition', () => {
  it('starts at the origin for an empty layout', () => {
    expect(freeNodePosition([], {})).toEqual({ x: 0, y: 0 })
  })

  it('lands below every existing node, never on top of one', () => {
    const nodes: Node[] = [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'end', type: 'end', title: 'End' }
    ]
    const layout = { start: { x: 0, y: 0 }, end: { x: 320, y: 0 } }
    const position = freeNodePosition(nodes, layout)
    expect(position.y).toBeGreaterThan(0)
    for (const existing of Object.values(layout)) {
      expect(position).not.toEqual(existing)
    }
  })

  it('lands below an expanded Loop container, not just its own layout entry (review round 1, minor #1)', () => {
    // A Loop with several body nodes renders much taller than a single node box
    // (computeLoopContainerBounds), so padding by WORKFLOW_NODE_HEIGHT alone would land the new
    // node visually inside the loop even though the raw layout coordinates don't collide.
    const bodyIds = ['a', 'b', 'c']
    const loop = loopNode('loop-1', bodyIds)
    const nodes: Node[] = [loop, ...bodyIds.map((id): Node => ({ id, type: 'end', title: id }))]
    const layout = {
      'loop-1': { x: 0, y: 0 },
      a: { x: 40, y: 40 },
      b: { x: 40, y: 200 },
      c: { x: 40, y: 360 }
    }
    const bounds = computeLoopContainerBounds(
      layout['loop-1']!,
      bodyIds.map((id) => layout[id]!)
    )

    const position = freeNodePosition(nodes, layout)

    expect(position.y).toBeGreaterThanOrEqual(layout['loop-1']!.y + bounds.height)
  })
})
