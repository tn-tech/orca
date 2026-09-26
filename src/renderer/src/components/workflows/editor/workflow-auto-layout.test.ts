import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '../../../../../shared/workflows/workflow-definition-types'
import { computeAutoLayout, WORKFLOW_NODE_WIDTH } from './workflow-auto-layout'

function startNode(id: string): Node {
  return { id, type: 'start', title: 'Start' }
}

function endNode(id: string): Node {
  return { id, type: 'end', title: 'End' }
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
