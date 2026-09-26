import type { Edge, LoopNode, Node, WorkflowProblem } from './workflow-definition-types'
import { findCyclicEdge } from './workflow-graph-cycles'

function error(problem: Omit<WorkflowProblem, 'severity'>): WorkflowProblem {
  return { ...problem, severity: 'error' }
}

/** Exactly one Start node and at least one End node (data-model.md "Graph validation rules"). */
export function checkStartAndEnd(nodes: Node[]): WorkflowProblem[] {
  const problems: WorkflowProblem[] = []
  const starts = nodes.filter((node) => node.type === 'start')
  if (starts.length === 0) {
    problems.push(
      error({ code: 'graph_missing_start', message: 'The workflow has no Start node.' })
    )
  }
  for (const extra of starts.slice(1)) {
    problems.push(
      error({
        code: 'graph_multiple_start_nodes',
        message: `Only one Start node is allowed; "${extra.id}" is an extra one.`,
        nodeId: extra.id
      })
    )
  }
  if (nodes.every((node) => node.type !== 'end')) {
    problems.push(error({ code: 'graph_missing_end', message: 'The workflow has no End node.' }))
  }
  return problems
}

/** A Loop node reaching its body implies reaching entryNodeId, even with no explicit edge. */
function reachabilityAdjacency(nodes: Node[], edges: Edge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  const add = (from: string, to: string): void => {
    const list = adjacency.get(from)
    if (list) {
      list.push(to)
    } else {
      adjacency.set(from, [to])
    }
  }
  for (const edge of edges) {
    add(edge.from, edge.to)
  }
  for (const node of nodes) {
    if (node.type === 'loop') {
      add(node.id, node.entryNodeId)
    }
  }
  return adjacency
}

/** Every node must be reachable from Start, walking real edges plus implicit loop-entry edges. */
export function checkReachability(nodes: Node[], edges: Edge[]): WorkflowProblem[] {
  const start = nodes.find((node) => node.type === 'start')
  if (!start) {
    return []
  }
  const adjacency = reachabilityAdjacency(nodes, edges)
  const reachable = new Set<string>([start.id])
  const queue = [start.id]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) {
      break
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next)
        queue.push(next)
      }
    }
  }
  return nodes
    .filter((node) => !reachable.has(node.id))
    .map((node) =>
      error({
        code: 'graph_unreachable_node',
        message: `Node "${node.id}" is not reachable from Start.`,
        nodeId: node.id
      })
    )
}

/** No cycle outside a Loop body; reports the edge that closes it (data-model.md rule). */
export function checkCycles(nodes: Node[], edges: Edge[]): WorkflowProblem[] {
  const edgeId = findCyclicEdge(nodes, edges)
  if (!edgeId) {
    return []
  }
  return [
    error({
      code: 'graph_cycle',
      message: `Edge "${edgeId}" closes a cycle outside any Loop body.`,
      edgeId
    })
  ]
}

/** v1 has no nested Loops, and a node belongs to at most one Loop body. */
function checkLoopBodyMembership(nodes: Node[], loops: LoopNode[]): WorkflowProblem[] {
  const problems: WorkflowProblem[] = []
  const owner = new Map<string, string>()
  for (const loop of loops) {
    for (const nodeId of new Set(loop.body.nodeIds)) {
      if (nodes.find((node) => node.id === nodeId)?.type === 'loop') {
        problems.push(
          error({
            code: 'graph_loop_nested',
            message: `Loop "${loop.id}" contains Loop "${nodeId}"; nested loops are not supported.`,
            nodeId: loop.id
          })
        )
      }
      const firstOwner = owner.get(nodeId)
      if (firstOwner === undefined) {
        owner.set(nodeId, loop.id)
      } else {
        problems.push(
          error({
            code: 'graph_loop_body_shared',
            message: `Node "${nodeId}" is in the bodies of both Loop "${firstOwner}" and Loop "${loop.id}".`,
            nodeId
          })
        )
      }
    }
  }
  return problems
}

/** Loop entry/exit must be inside the body; body nodes may only leave via the loop's ports;
 *  `maxIterations` must be set (FR-006, US2 AS4 — the editor represents "unset" as `< 1`,
 *  since the persisted schema requires a positive integer). */
export function checkLoopNodes(nodes: Node[], edges: Edge[]): WorkflowProblem[] {
  const loops = nodes.filter((node): node is LoopNode => node.type === 'loop')
  const problems: WorkflowProblem[] = checkLoopBodyMembership(nodes, loops)
  for (const loop of loops) {
    if (loop.maxIterations < 1) {
      problems.push(
        error({
          code: 'graph_loop_missing_max_iterations',
          message: `Loop "${loop.id}" needs a maximum iteration count.`,
          nodeId: loop.id
        })
      )
    }
    const body = new Set(loop.body.nodeIds)
    if (!body.has(loop.entryNodeId)) {
      problems.push(
        error({
          code: 'graph_loop_entry_not_in_body',
          message: `Loop "${loop.id}" entry node "${loop.entryNodeId}" is not in its body.`,
          nodeId: loop.id
        })
      )
    }
    if (!body.has(loop.exitNodeId)) {
      problems.push(
        error({
          code: 'graph_loop_exit_not_in_body',
          message: `Loop "${loop.id}" exit node "${loop.exitNodeId}" is not in its body.`,
          nodeId: loop.id
        })
      )
    }
    for (const edge of edges) {
      if (
        body.has(edge.from) &&
        !body.has(edge.to) &&
        edge.fromPort !== 'body' &&
        edge.fromPort !== 'exit'
      ) {
        problems.push(
          error({
            code: 'graph_loop_body_edge_escapes',
            message: `Edge "${edge.id}" leaves loop "${loop.id}"'s body without going through a loop port.`,
            nodeId: loop.id,
            edgeId: edge.id
          })
        )
      }
    }
  }
  return problems
}

/** Join: at least two incoming edges, and a quorum policy must not exceed that count. */
export function checkJoinNodes(nodes: Node[], edges: Edge[]): WorkflowProblem[] {
  const problems: WorkflowProblem[] = []
  for (const join of nodes.filter((node) => node.type === 'join')) {
    const incoming = edges.filter((edge) => edge.to === join.id).length
    if (incoming < 2) {
      problems.push(
        error({
          code: 'graph_join_insufficient_incoming',
          message: `Join "${join.id}" has ${incoming} incoming edge(s); at least 2 are required.`,
          nodeId: join.id
        })
      )
    }
    if (typeof join.policy === 'object' && join.policy.quorum > incoming) {
      problems.push(
        error({
          code: 'graph_join_quorum_exceeds_incoming',
          message: `Join "${join.id}" quorum ${join.policy.quorum} exceeds its ${incoming} incoming edge(s).`,
          nodeId: join.id
        })
      )
    }
  }
  return problems
}

/** Every option/choice needs exactly one outgoing edge on that port; no other edges are allowed. */
function checkPortOptions(nodeId: string, options: string[], edges: Edge[]): WorkflowProblem[] {
  const problems: WorkflowProblem[] = []
  const outgoing = edges.filter((edge) => edge.from === nodeId)
  for (const option of options) {
    const matches = outgoing.filter((edge) => edge.fromPort === option)
    if (matches.length === 0) {
      problems.push(
        error({
          code: 'graph_option_missing_edge',
          message: `Node "${nodeId}" option "${option}" has no outgoing edge.`,
          nodeId
        })
      )
    }
    for (const duplicate of matches.slice(1)) {
      problems.push(
        error({
          code: 'graph_option_duplicate_edge',
          message: `Node "${nodeId}" option "${option}" has more than one outgoing edge.`,
          nodeId,
          edgeId: duplicate.id
        })
      )
    }
  }
  for (const edge of outgoing) {
    if (edge.fromPort === undefined || !options.includes(edge.fromPort)) {
      problems.push(
        error({
          code: 'graph_unexpected_edge',
          message: `Node "${nodeId}" has an outgoing edge "${edge.id}" that is not tied to one of its options.`,
          nodeId,
          edgeId: edge.id
        })
      )
    }
  }
  return problems
}

/** Approval options and Router choices are both "exactly one edge per port, no other edges". */
export function checkPortedNodes(nodes: Node[], edges: Edge[]): WorkflowProblem[] {
  const problems: WorkflowProblem[] = []
  for (const node of nodes) {
    if (node.type === 'approval') {
      problems.push(...checkPortOptions(node.id, node.options, edges))
    } else if (node.type === 'router') {
      problems.push(...checkPortOptions(node.id, node.choices, edges))
    }
  }
  return problems
}
