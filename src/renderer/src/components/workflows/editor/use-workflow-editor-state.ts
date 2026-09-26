import { useMemo, useReducer } from 'react'
import type {
  Condition,
  Node,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { computeAutoLayout } from './workflow-auto-layout'
import {
  addNodeToDefinition,
  connectNodesInDefinition,
  deleteElementsFromDefinition,
  updateEdgeConditionInDefinition,
  updateNodeInDefinition,
  type WorkflowEditorProblem
} from './workflow-editor-commands'

const MAX_HISTORY_ENTRIES = 50

/** One undo step: `manualPositionIds` travels with `definition` so undo can't desync the two. */
type WorkflowEditorHistoryEntry = {
  definition: Workflow
  manualPositionIds: ReadonlySet<string>
}

/** Editor state: the definition being edited plus bookkeeping the file format doesn't carry. */
export type WorkflowEditorState = {
  definition: Workflow
  /** Node ids the user dragged this session (FR-010: "Re-layout" must leave these alone). */
  manualPositionIds: ReadonlySet<string>
  /** Undo stack of prior (definition, manualPositionIds) pairs, most recent last. */
  history: readonly WorkflowEditorHistoryEntry[]
  dirty: boolean
  revision: number
  /** The problem from the last refused command (e.g. a cycle), cleared on the next success. */
  lastProblem?: WorkflowEditorProblem
}

export type WorkflowEditorAction =
  | { type: 'add-node'; node: Node; position: { x: number; y: number } }
  | { type: 'connect'; from: string; to: string; fromPort?: string }
  | { type: 'delete-elements'; nodeIds?: string[]; edgeIds?: string[] }
  | { type: 'update-node'; node: Node }
  | { type: 'update-edge-condition'; edgeId: string; condition?: Condition }
  | { type: 'move-node'; nodeId: string; position: { x: number; y: number } }
  | { type: 'auto-layout' }
  /** A fresh definition arrived (reload, or a run snapshot); see FR-010 handling below. */
  | { type: 'load-definition'; definition: Workflow }
  | { type: 'undo' }

export function createInitialWorkflowEditorState(definition: Workflow): WorkflowEditorState {
  return { definition, manualPositionIds: new Set(), history: [], dirty: false, revision: 0 }
}

function pinnedLayout(
  definition: Workflow,
  manualPositionIds: ReadonlySet<string>
): Record<string, { x: number; y: number }> {
  const pinned: Record<string, { x: number; y: number }> = {}
  for (const nodeId of manualPositionIds) {
    const position = definition.layout[nodeId]
    if (position) {
      pinned[nodeId] = position
    }
  }
  return pinned
}

/** Commits a new definition (and, when it changed too, the pin set) as one undoable step. */
function commit(
  state: WorkflowEditorState,
  definition: Workflow,
  manualPositionIds: ReadonlySet<string> = state.manualPositionIds
): WorkflowEditorState {
  const previousEntry: WorkflowEditorHistoryEntry = {
    definition: state.definition,
    manualPositionIds: state.manualPositionIds
  }
  return {
    ...state,
    definition,
    manualPositionIds,
    history: [...state.history, previousEntry].slice(-MAX_HISTORY_ENTRIES),
    dirty: true,
    revision: state.revision + 1,
    lastProblem: undefined
  }
}

function refuse(state: WorkflowEditorState, problem: WorkflowEditorProblem): WorkflowEditorState {
  return { ...state, lastProblem: problem }
}

/**
 * Framework-light: pure over `{ definition, layout }` plus editor-only bookkeeping. `load-definition`
 * (a reload from disk, or a run-snapshot refresh) keeps this session's manually dragged positions
 * and otherwise adopts the incoming layout as-is; a later `auto-layout` dispatch (the "Re-layout"
 * action) is what actually re-runs dagre for the nodes the user hasn't touched (FR-010).
 */
export function workflowEditorReducer(
  state: WorkflowEditorState,
  action: WorkflowEditorAction
): WorkflowEditorState {
  switch (action.type) {
    case 'add-node':
      return commit(state, addNodeToDefinition(state.definition, action.node, action.position))

    case 'connect': {
      const result = connectNodesInDefinition(state.definition, action)
      return result.ok ? commit(state, result.definition) : refuse(state, result.problem)
    }

    case 'delete-elements': {
      const nextDefinition = deleteElementsFromDefinition(state.definition, action)
      const manualPositionIds = new Set(state.manualPositionIds)
      for (const nodeId of action.nodeIds ?? []) {
        manualPositionIds.delete(nodeId)
      }
      return commit(state, nextDefinition, manualPositionIds)
    }

    case 'update-node': {
      const result = updateNodeInDefinition(state.definition, action.node)
      return result.ok ? commit(state, result.definition) : refuse(state, result.problem)
    }

    case 'update-edge-condition': {
      const result = updateEdgeConditionInDefinition(
        state.definition,
        action.edgeId,
        action.condition
      )
      return result.ok ? commit(state, result.definition) : refuse(state, result.problem)
    }

    case 'move-node': {
      const nextDefinition: Workflow = {
        ...state.definition,
        layout: { ...state.definition.layout, [action.nodeId]: action.position }
      }
      const manualPositionIds = new Set(state.manualPositionIds)
      manualPositionIds.add(action.nodeId)
      return commit(state, nextDefinition, manualPositionIds)
    }

    case 'auto-layout': {
      const layout = computeAutoLayout(state.definition.nodes, state.definition.edges, {
        pinned: pinnedLayout(state.definition, state.manualPositionIds)
      })
      return commit(state, { ...state.definition, layout })
    }

    case 'load-definition': {
      const incoming = action.definition
      const manualPositionIds = new Set(
        [...state.manualPositionIds].filter((nodeId) =>
          incoming.nodes.some((node) => node.id === nodeId)
        )
      )
      const layout = { ...incoming.layout, ...pinnedLayout(state.definition, manualPositionIds) }
      return {
        definition: { ...incoming, layout },
        manualPositionIds,
        history: [],
        dirty: false,
        revision: state.revision + 1,
        lastProblem: undefined
      }
    }

    case 'undo': {
      const previous = state.history.at(-1)
      if (!previous) {
        return state
      }
      return {
        ...state,
        definition: previous.definition,
        manualPositionIds: previous.manualPositionIds,
        history: state.history.slice(0, -1),
        dirty: true,
        revision: state.revision + 1,
        lastProblem: undefined
      }
    }
  }
}

export type WorkflowEditorController = {
  state: WorkflowEditorState
  dispatch: (action: WorkflowEditorAction) => void
  canUndo: boolean
}

/** Thin React wrapper: `useReducer` over the pure reducer. */
export function useWorkflowEditorState(initialDefinition: Workflow): WorkflowEditorController {
  const [state, dispatch] = useReducer(
    workflowEditorReducer,
    initialDefinition,
    createInitialWorkflowEditorState
  )
  const canUndo = state.history.length > 0
  return useMemo(() => ({ state, dispatch, canUndo }), [state, dispatch, canUndo])
}
