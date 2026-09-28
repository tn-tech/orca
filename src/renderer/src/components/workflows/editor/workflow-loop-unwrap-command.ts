import { translate } from '@/i18n/i18n'
import type { Workflow } from '../../../../../shared/workflows/workflow-definition-types'
import type { WorkflowEditorCommandResult } from './workflow-editor-commands'

/**
 * Reverses `wrapNodesInLoopInDefinition` (`workflow-loop-commands.ts`) — a separate file so
 * neither command pushes the other over the 300-line cap. Undoes what `reconnectEdgesForLoop` did
 * to every edge crossing the Loop's boundary, in both directions: an edge redirected onto the
 * Loop's id now targets `entryNodeId` again, and an edge sourced from the Loop now targets
 * `exitNodeId` instead — whether it's the body-sourced `exit`-tagged form
 * `wrapNodesInLoopInDefinition` itself produces, or one drawn later straight from the Loop node's
 * own `exit` handle (`LoopNode.tsx`), which `unwrapLoopInDefinition` previously missed (F4 review
 * round 1, Important #1). A rewritten edge that would point at a node that no longer exists —
 * `entryNodeId`/`exitNodeId` left dangling by a body-node delete elsewhere in the Loop (F4 review
 * round 1, Important #2) — is dropped instead of pointed at a ghost. Two edges that both rewrite
 * to the same `(from, to, fromPort)` — a body-sourced exit edge and a loop-sourced one drawn to
 * the same target, say — collapse to one instead of both surviving as identical-looking duplicates
 * (F4 re-review 1, Minor). Refuses, without mutating anything, when `loopNodeId` isn't a Loop node.
 */
export function unwrapLoopInDefinition(
  definition: Workflow,
  loopNodeId: string
): WorkflowEditorCommandResult {
  const loop = definition.nodes.find((node) => node.id === loopNodeId)
  if (!loop || loop.type !== 'loop') {
    return {
      ok: false,
      problem: {
        code: 'workflow_editor_unwrap_not_a_loop',
        message: translate(
          'auto.components.workflows.editor.workflow-loop-unwrap-command.notALoop',
          'Select a Loop node to unwrap.'
        )
      }
    }
  }

  const { entryNodeId, exitNodeId } = loop
  const nodes = definition.nodes.filter((node) => node.id !== loopNodeId)
  const survivingIds = new Set(nodes.map((node) => node.id))

  const rewritten = definition.edges.flatMap((edge) => {
    if (edge.to === loopNodeId) {
      return survivingIds.has(entryNodeId) ? [{ ...edge, to: entryNodeId }] : []
    }
    if (edge.from === loopNodeId) {
      if (!survivingIds.has(exitNodeId)) {
        return []
      }
      const { fromPort: _exitPort, ...rest } = edge
      return [{ ...rest, from: exitNodeId }]
    }
    if (edge.from === exitNodeId && edge.fromPort === 'exit') {
      const { fromPort: _exitPort, ...rest } = edge
      return [rest]
    }
    return [edge]
  })

  // A body-sourced exit edge and a loop-sourced one to the same target both rewrite to the same
  // (from, to, fromPort) — keep the first, drop the rest (F4 re-review 1, Minor).
  const seenEdgeKeys = new Set<string>()
  const edges = rewritten.filter((edge) => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.fromPort ?? ''}`
    if (seenEdgeKeys.has(key)) {
      return false
    }
    seenEdgeKeys.add(key)
    return true
  })

  const { [loopNodeId]: _removedLayout, ...layout } = definition.layout
  return { ok: true, definition: { ...definition, nodes, edges, layout } }
}
