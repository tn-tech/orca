import { useCallback } from 'react'
import { workflowEditorReducer } from './editor/use-workflow-editor-state'
import type { LoopEdit } from './editor/workflow-loop-membership-commands'
import type { WorkflowEditorSession } from './workflow-editor-session-types'

export type UseWorkflowEditorMutationsParams = {
  session: WorkflowEditorSession
  selectedNodeId: string | undefined
  selectedEdgeId: string | undefined
  setSelectedNodeId: (nodeId: string | undefined) => void
  setSelectedEdgeId: (edgeId: string | undefined) => void
}

export type WorkflowEditorMutations = {
  deleteNode: (nodeId: string) => void
  deleteEdge: (edgeId: string) => void
  /** Keyboard Delete/Backspace (F4): acts on whichever of the two the canvas currently selects. */
  deleteSelection: () => void
  unwrapLoop: (nodeId: string) => void
  editLoop: (loopId: string, edit: LoopEdit) => void
  undo: () => void
}

/**
 * F4's delete/undo/unwrap editor actions, split out of `use-workflows-page-controller.ts` (F4
 * review round 1, Minor #9 — the controller had grown past the 300-line cap). Delete and Undo
 * follow the same rule as every other edit while a run is shown: neither is blocked, matching Add
 * node, Wrap in Loop, connect, drag, edge conditions and roles, none of which are gated on
 * `run.snapshot` either (F4 review round 1, Minor #3 — the run-view `NodeInspector` -> `AttemptPanel`
 * swap is a display choice for node settings, not an editing-disabled rule, and treating it as one
 * here was inconsistent with the rest of the editor).
 */
export function useWorkflowEditorMutations({
  session,
  selectedNodeId,
  selectedEdgeId,
  setSelectedNodeId,
  setSelectedEdgeId
}: UseWorkflowEditorMutationsParams): WorkflowEditorMutations {
  const deleteNode = useCallback(
    (nodeId: string) => {
      if (session.status !== 'ready') {
        return
      }
      session.editor.dispatch({ type: 'delete-elements', nodeIds: [nodeId] })
      setSelectedNodeId(undefined)
    },
    [session, setSelectedNodeId]
  )

  const deleteEdge = useCallback(
    (edgeId: string) => {
      if (session.status !== 'ready') {
        return
      }
      session.editor.dispatch({ type: 'delete-elements', edgeIds: [edgeId] })
      setSelectedEdgeId(undefined)
    },
    [session, setSelectedEdgeId]
  )

  const deleteSelection = useCallback(() => {
    if (selectedNodeId) {
      deleteNode(selectedNodeId)
    } else if (selectedEdgeId) {
      deleteEdge(selectedEdgeId)
    }
  }, [deleteEdge, deleteNode, selectedEdgeId, selectedNodeId])

  const unwrapLoop = useCallback(
    (nodeId: string) => {
      if (session.status !== 'ready') {
        return
      }
      session.editor.dispatch({ type: 'unwrap-loop', nodeId })
      setSelectedNodeId(undefined)
    },
    [session, setSelectedNodeId]
  )

  const editLoop = useCallback(
    (loopId: string, edit: LoopEdit) => {
      if (session.status === 'ready') {
        session.editor.dispatch({ type: 'edit-loop', loopId, edit })
      }
    },
    [session]
  )

  /** F4 review round 1, Minor #4: undoing e.g. an `add-node` while that node is selected left
   *  `selectedNodeId` pointing at a node the reducer just made disappear — `canDelete` stayed
   *  true, so the next Backspace dispatched a no-op `delete-elements` for a missing id. Peeks at
   *  the pure reducer's result (no dispatch yet) to clear whichever selection the undo is about to
   *  invalidate, before actually dispatching it. */
  const undo = useCallback(() => {
    if (session.status !== 'ready') {
      return
    }
    const next = workflowEditorReducer(session.editor.state, { type: 'undo' })
    session.editor.dispatch({ type: 'undo' })
    if (selectedNodeId && !next.definition.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(undefined)
    }
    if (selectedEdgeId && !next.definition.edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(undefined)
    }
  }, [session, selectedNodeId, selectedEdgeId, setSelectedNodeId, setSelectedEdgeId])

  return { deleteNode, deleteEdge, deleteSelection, unwrapLoop, editLoop, undo }
}
