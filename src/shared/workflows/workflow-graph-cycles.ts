import type { Edge, LoopNode, Node } from './workflow-definition-types'

/** node ids per Loop body, so intra-body edges (the loop's own iteration back-edge) can be excluded. */
function loopBodies(nodes: Node[]): Set<string>[] {
  return nodes
    .filter((node): node is LoopNode => node.type === 'loop')
    .map((loop) => new Set(loop.body.nodeIds))
}

function isInsideAnyLoopBody(edge: Edge, bodies: Set<string>[]): boolean {
  return bodies.some((body) => body.has(edge.from) && body.has(edge.to))
}

/**
 * Finds a cycle in the graph formed by edges whose endpoints are not both inside the same
 * Loop body (data-model.md "Graph validation rules"). Returns the id of the edge that closes
 * the cycle, or undefined when the graph — minus intra-loop-body edges — is acyclic.
 */
export function findCyclicEdge(nodes: Node[], edges: Edge[]): string | undefined {
  const bodies = loopBodies(nodes)
  const relevantEdges = edges.filter((edge) => !isInsideAnyLoopBody(edge, bodies))
  const outgoing = new Map<string, Edge[]>()
  for (const edge of relevantEdges) {
    const list = outgoing.get(edge.from)
    if (list) {
      list.push(edge)
    } else {
      outgoing.set(edge.from, [edge])
    }
  }

  const UNVISITED = 0
  const IN_PROGRESS = 1
  const DONE = 2
  const state = new Map<string, number>(nodes.map((node) => [node.id, UNVISITED]))
  let offendingEdgeId: string | undefined

  function visit(nodeId: string): boolean {
    state.set(nodeId, IN_PROGRESS)
    for (const edge of outgoing.get(nodeId) ?? []) {
      const targetState = state.get(edge.to)
      if (targetState === IN_PROGRESS) {
        offendingEdgeId = edge.id
        return true
      }
      if (targetState === UNVISITED && visit(edge.to)) {
        return true
      }
    }
    state.set(nodeId, DONE)
    return false
  }

  for (const node of nodes) {
    if (state.get(node.id) === UNVISITED && visit(node.id)) {
      return offendingEdgeId
    }
  }
  return undefined
}
