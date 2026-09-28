import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '../../../../../shared/workflows/workflow-definition-types'
import { computeAutoLayout, measureWorkflowNodeSize } from './workflow-auto-layout'
import { computeEdgeBendLanes } from './workflow-edge-routing'

function startNode(id: string): Node {
  return { id, type: 'start', title: 'Start' }
}

function endNode(id: string): Node {
  return { id, type: 'end', title: 'End' }
}

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

function edge(id: string, from: string, to: string): Edge {
  return { id, from, to }
}

describe('computeEdgeBendLanes', () => {
  it('bends a skip edge that would otherwise run behind the nodes it bypasses (F10: "Start -> End vanishes")', () => {
    const nodes = [startNode('start'), agentNode('a'), agentNode('b'), endNode('end')]
    const edges = [
      edge('start-a', 'start', 'a'),
      edge('a-b', 'a', 'b'),
      edge('b-end', 'b', 'end'),
      edge('skip', 'start', 'end')
    ]
    const layout = computeAutoLayout(nodes, edges)

    const lanes = computeEdgeBendLanes(nodes, edges, layout)

    expect(lanes.has('skip')).toBe(true)
    // The chosen lane clears every node's box between Start and End.
    const laneY = lanes.get('skip')
    for (const node of [nodes[1], nodes[2]]) {
      const position = layout[node.id]
      const size = measureWorkflowNodeSize(node)
      const clearsAbove = (laneY ?? 0) < position.y
      const clearsBelow = (laneY ?? 0) > position.y + size.height
      expect(clearsAbove || clearsBelow).toBe(true)
    }
  })

  it('does not bend an edge with nothing between its endpoints', () => {
    const nodes = [startNode('start'), endNode('end')]
    const edges = [edge('e1', 'start', 'end')]
    const layout = computeAutoLayout(nodes, edges)

    const lanes = computeEdgeBendLanes(nodes, edges, layout)

    expect(lanes.size).toBe(0)
  })

  it('does not bend the segments that make up the chain the skip edge bypasses', () => {
    const nodes = [startNode('start'), agentNode('a'), agentNode('b'), endNode('end')]
    const edges = [
      edge('start-a', 'start', 'a'),
      edge('a-b', 'a', 'b'),
      edge('b-end', 'b', 'end'),
      edge('skip', 'start', 'end')
    ]
    const layout = computeAutoLayout(nodes, edges)

    const lanes = computeEdgeBendLanes(nodes, edges, layout)

    expect(lanes.has('start-a')).toBe(false)
    expect(lanes.has('a-b')).toBe(false)
    expect(lanes.has('b-end')).toBe(false)
  })
})
