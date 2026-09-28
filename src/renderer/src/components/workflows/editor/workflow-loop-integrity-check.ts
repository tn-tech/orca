import { translate } from '@/i18n/i18n'
import type {
  Workflow,
  WorkflowProblem
} from '../../../../../shared/workflows/workflow-definition-types'

/**
 * Defensive check (F4 review round 1, Important #2): flags a Loop whose `body.nodeIds`,
 * `entryNodeId` or `exitNodeId` names a node id that isn't in `definition.nodes` at all. This is
 * distinct from the shared `checkLoopNodes`' `graph_loop_entry_not_in_body`/
 * `graph_loop_exit_not_in_body` (`workflow-graph-structural-rules.ts`), which only checks that
 * entry/exit are *within* the body set — not that the ids in that set correspond to real nodes.
 * `deleteElementsFromDefinition` always keeps a Loop's body in sync with the nodes that still
 * exist, so this should never fire on a file this editor produced; it guards against one that
 * wasn't (hand-edited, written by other tooling, or a future editor bug). Renderer-only (not a
 * `src/shared` change) merged into `use-workflows-page-controller.ts`'s local validation.
 */
export function checkLoopReferencesMissingNodes(definition: Workflow): WorkflowProblem[] {
  const nodeIds = new Set(definition.nodes.map((node) => node.id))
  const problems: WorkflowProblem[] = []
  for (const node of definition.nodes) {
    if (node.type !== 'loop') {
      continue
    }
    const referenced = new Set([...node.body.nodeIds, node.entryNodeId, node.exitNodeId])
    for (const missingId of referenced) {
      if (nodeIds.has(missingId)) {
        continue
      }
      problems.push({
        severity: 'error',
        code: 'graph_loop_references_missing_node',
        message: translate(
          'auto.components.workflows.editor.workflow-loop-integrity-check.missingNode',
          'Loop "{{loopId}}" references node "{{missingId}}", which no longer exists.',
          { loopId: node.id, missingId }
        ),
        nodeId: node.id
      })
    }
  }
  return problems
}
