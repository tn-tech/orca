import { useMemo, useReducer } from 'react'
import type {
  Condition,
  Node,
  Role,
  Workflow
} from '../../../../../shared/workflows/workflow-definition-types'
import { computeAutoLayout, type MeasuredNodeSize } from './workflow-auto-layout'
import {
  addNodeToDefinition,
  connectNodesInDefinition,
  deleteElementsFromDefinition,
  removeRoleFromDefinition,
  setRoleInDefinition,
  updateEdgeConditionInDefinition,
  updateNodeInDefinition,
  type WorkflowEditorProblem
} from './workflow-editor-commands'
import {
  updateWorkflowSettingsInDefinition,
  type WorkflowSettingsPatch
} from './workflow-settings-command'
import { wrapNodesInLoopInDefinition } from './workflow-loop-commands'
import { editLoopInDefinition, type LoopEdit } from './workflow-loop-membership-commands'
import { unwrapLoopInDefinition } from './workflow-loop-unwrap-command'

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
  /** "Re-layout". `measuredSizes` is the canvas's own current read of React Flow's real node
   *  sizes (`WorkflowCanvas.tsx`'s `getMeasuredSizes`); omitted, `computeAutoLayout` falls back to
   *  its estimate for every node. */
  | { type: 'auto-layout'; measuredSizes?: ReadonlyMap<string, MeasuredNodeSize> }
  /** FR-005/FR-006, US2 AS5: wraps `nodeIds` (an existing selection, or a refused back-edge's
   *  two endpoints) in a new Loop node. */
  | { type: 'wrap-in-loop'; nodeIds: string[] }
  /** F4: reverses `wrap-in-loop` — removes the Loop node, keeps its body, re-links entry/exit
   *  edges (`workflow-loop-unwrap-command.ts`'s `unwrapLoopInDefinition`). */
  | { type: 'unwrap-loop'; nodeId: string }
  /** F11: entry/exit/body edits from the Loop inspector. */
  | { type: 'edit-loop'; loopId: string; edit: LoopEdit }
  /** US4 AS1: creates or updates a role in `definition.roles` (`roles/RolesPanel.tsx`,
   *  `roles/RoleEditor.tsx`). */
  | { type: 'set-role'; roleId: string; role: Role }
  /** Removes a role and clears it from every node that referenced it. */
  | { type: 'remove-role'; roleId: string }
  /** F13: workspace policy / default concurrency limit (`WorkflowSettingsPanel`). */
  | { type: 'update-settings'; patch: WorkflowSettingsPatch }
  /** A fresh definition arrived (reload, or a run snapshot); see FR-010 handling below. */
  | { type: 'load-definition'; definition: Workflow }
  | { type: 'undo' }
  /** A write to disk just succeeded for the current definition; clears dirty without touching
   *  history/revision so undo and the "unsaved changes" state stay independently correct. */
  | { type: 'mark-saved' }
  /** The user closed the last-refused-command notice (US2 AS5) without acting on it. */
  | { type: 'dismiss-problem' }

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

/** Dragging a Loop container moves its body nodes with it (they render at a position relative to
 *  it in `WorkflowCanvas.tsx`, so leaving them at their old absolute position would visually
 *  wrench them out of the box). Dragging any other node is unaffected. */
function movedLayout(
  definition: Workflow,
  action: { nodeId: string; position: { x: number; y: number } }
): Record<string, { x: number; y: number }> {
  const moved = definition.nodes.find((node) => node.id === action.nodeId)
  const previous = definition.layout[action.nodeId] ?? action.position
  const delta = { x: action.position.x - previous.x, y: action.position.y - previous.y }
  const next: Record<string, { x: number; y: number }> = { [action.nodeId]: action.position }
  if (moved?.type === 'loop') {
    for (const childId of moved.body.nodeIds) {
      const childPosition = definition.layout[childId]
      if (childPosition) {
        next[childId] = { x: childPosition.x + delta.x, y: childPosition.y + delta.y }
      }
    }
  }
  return next
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

/** Drops any pinned id no longer present in `definition` — shared by every command that can make
 *  a node disappear the caller didn't name directly (a Loop's cascade-deleted/unwrapped body, or
 *  a freshly loaded definition that dropped a node this session had dragged). */
function pruneManualPositionIds(
  manualPositionIds: ReadonlySet<string>,
  definition: Workflow
): Set<string> {
  return new Set(
    [...manualPositionIds].filter((nodeId) => definition.nodes.some((node) => node.id === nodeId))
  )
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
      return commit(
        state,
        nextDefinition,
        pruneManualPositionIds(state.manualPositionIds, nextDefinition)
      )
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
        layout: { ...state.definition.layout, ...movedLayout(state.definition, action) }
      }
      const manualPositionIds = new Set(state.manualPositionIds)
      manualPositionIds.add(action.nodeId)
      return commit(state, nextDefinition, manualPositionIds)
    }

    case 'wrap-in-loop': {
      const result = wrapNodesInLoopInDefinition(state.definition, action.nodeIds)
      return result.ok ? commit(state, result.definition) : refuse(state, result.problem)
    }

    case 'unwrap-loop': {
      const result = unwrapLoopInDefinition(state.definition, action.nodeId)
      if (!result.ok) {
        return refuse(state, result.problem)
      }
      return commit(
        state,
        result.definition,
        pruneManualPositionIds(state.manualPositionIds, result.definition)
      )
    }

    case 'edit-loop': {
      const result = editLoopInDefinition(state.definition, action.loopId, action.edit)
      return result.ok ? commit(state, result.definition) : refuse(state, result.problem)
    }

    case 'set-role':
      return commit(state, setRoleInDefinition(state.definition, action.roleId, action.role))

    case 'remove-role':
      return commit(state, removeRoleFromDefinition(state.definition, action.roleId))

    case 'update-settings':
      return commit(state, updateWorkflowSettingsInDefinition(state.definition, action.patch))

    case 'auto-layout': {
      // Prefers a real measured size over the estimate; anchors a pinned Loop-body node to its
      // Loop's pre-layout position instead of a stale absolute one.
      const layout = computeAutoLayout(state.definition.nodes, state.definition.edges, {
        pinned: pinnedLayout(state.definition, state.manualPositionIds),
        currentLayout: state.definition.layout,
        measuredSizes: action.measuredSizes
      })
      return commit(state, { ...state.definition, layout })
    }

    case 'load-definition': {
      const incoming = action.definition
      const manualPositionIds = pruneManualPositionIds(state.manualPositionIds, incoming)
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

    case 'mark-saved':
      return state.dirty ? { ...state, dirty: false } : state

    case 'dismiss-problem':
      return state.lastProblem ? { ...state, lastProblem: undefined } : state
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
