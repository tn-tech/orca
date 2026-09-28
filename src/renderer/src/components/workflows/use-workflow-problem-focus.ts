import { useCallback } from 'react'
import type {
  Node,
  Workflow,
  WorkflowProblem
} from '../../../../shared/workflows/workflow-definition-types'

/** Only Agent/Router/Reflection nodes dispatch through a role (workflow-graph-validation.ts). */
function nodeRoleId(node: Node): string | undefined {
  return node.type === 'agent' || node.type === 'router' || node.type === 'reflection'
    ? node.roleId
    : undefined
}

export type UseWorkflowProblemFocusParams = {
  definition: Workflow | null
  setSelectedNodeId: (nodeId: string | undefined) => void
  setSelectedEdgeId: (edgeId: string | undefined) => void
}

/**
 * `ValidationProblemsPanel`'s "focus" action (FR-009): selects whatever node, edge or role a
 * problem names, so `NodeInspector` opens on it. Split out of `use-workflows-page-controller.ts`
 * (F4 review round 1, Minor #9 — the controller had grown past the 300-line cap).
 */
export function useWorkflowProblemFocus({
  definition,
  setSelectedNodeId,
  setSelectedEdgeId
}: UseWorkflowProblemFocusParams): (problem: WorkflowProblem) => void {
  return useCallback(
    (problem: WorkflowProblem) => {
      if (problem.nodeId) {
        setSelectedNodeId(problem.nodeId)
        setSelectedEdgeId(undefined)
        return
      }
      if (problem.edgeId) {
        setSelectedEdgeId(problem.edgeId)
        setSelectedNodeId(undefined)
        return
      }
      if (problem.roleId && definition) {
        const node = definition.nodes.find((candidate) => nodeRoleId(candidate) === problem.roleId)
        if (node) {
          setSelectedNodeId(node.id)
          setSelectedEdgeId(undefined)
        }
      }
    },
    [definition, setSelectedNodeId, setSelectedEdgeId]
  )
}
