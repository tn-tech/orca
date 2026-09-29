import type { Edge, LoopNode, Node, WorkflowProblem } from './workflow-definition-types'

// Split out of workflow-graph-structural-rules.ts (F4 re-review 1) to keep that file under the
// 300-line cap once the Loop rule grew to also catch a missing-node reference.
function error(problem: Omit<WorkflowProblem, 'severity'>): WorkflowProblem {
  return { ...problem, severity: 'error' }
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
 *  since the persisted schema requires a positive integer). Also catches a Loop naming a node id
 *  that isn't in the workflow at all — e.g. the editor deletes a node without repairing the Loops
 *  that pointed at it (`deleteElementsFromDefinition` leaves a deleted entry/exit id in place on
 *  purpose so it's flagged, not silently repaired) — so save, run and validate all agree with the
 *  editor instead of only the editor refusing (F4 re-review 1, controller ruling; this rule used
 *  to be a renderer-only check that diverged from these paths). Entry/exit get exactly one error
 *  row each regardless of which of the two conditions ("not in body" vs "doesn't exist") is true,
 *  so a deleted entry/exit never reports both for the same cause. */
export function checkLoopNodes(nodes: Node[], edges: Edge[]): WorkflowProblem[] {
  const loops = nodes.filter((node): node is LoopNode => node.type === 'loop')
  const problems: WorkflowProblem[] = checkLoopBodyMembership(nodes, loops)
  const existingNodeIds = new Set(nodes.map((node) => node.id))
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
    if (!body.has(loop.entryNodeId) || !existingNodeIds.has(loop.entryNodeId)) {
      problems.push(
        error({
          code: 'graph_loop_entry_not_in_body',
          message: `Loop "${loop.id}" entry node "${loop.entryNodeId}" is not in its body.`,
          nodeId: loop.id
        })
      )
    }
    if (!body.has(loop.exitNodeId) || !existingNodeIds.has(loop.exitNodeId)) {
      problems.push(
        error({
          code: 'graph_loop_exit_not_in_body',
          message: `Loop "${loop.id}" exit node "${loop.exitNodeId}" is not in its body.`,
          nodeId: loop.id
        })
      )
    }
    for (const bodyNodeId of loop.body.nodeIds) {
      if (bodyNodeId === loop.entryNodeId || bodyNodeId === loop.exitNodeId) {
        continue
      }
      if (!existingNodeIds.has(bodyNodeId)) {
        problems.push(
          error({
            code: 'graph_loop_body_references_missing_node',
            message: `Loop "${loop.id}" body references node "${bodyNodeId}", which no longer exists.`,
            nodeId: loop.id
          })
        )
      }
    }
    for (const edge of edges) {
      // An exit edge fires when the Loop settles, so one landing back in its own body never runs.
      if (
        edge.fromPort === 'exit' &&
        (edge.from === loop.id || body.has(edge.from)) &&
        body.has(edge.to)
      ) {
        problems.push(
          error({
            code: 'graph_loop_exit_edge_into_body',
            message: `Edge "${edge.id}" leaves loop "${loop.id}" through its exit but leads back into the loop's body.`,
            nodeId: loop.id,
            edgeId: edge.id
          })
        )
      }
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
