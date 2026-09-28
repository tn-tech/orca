import { useEffect } from 'react'
import { isEditableTarget } from '@/lib/editable-target'
import { getShortcutPlatform } from '@/lib/shortcut-platform'

/** Delete/Backspace remove the current node or edge selection (F4). Any modifier held bows out,
 *  so a future Cmd/Ctrl-Backspace shortcut elsewhere in the app is never shadowed here. */
export function isWorkflowEditorDeleteShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return false
  }
  return event.key === 'Delete' || event.key === 'Backspace'
}

/** Cmd+Z (Mac) / Ctrl+Z (Linux, Windows) — AGENTS.md: never hardcode `metaKey`. Never matches
 *  with Shift held, which would be a redo the reducer doesn't support. */
export function isWorkflowEditorUndoShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  isMac: boolean = getShortcutPlatform() === 'darwin'
): boolean {
  if (event.key.toLowerCase() !== 'z' || event.altKey || event.shiftKey) {
    return false
  }
  return isMac ? Boolean(event.metaKey) && !event.ctrlKey : Boolean(event.ctrlKey) && !event.metaKey
}

/** A dialog, menu, listbox or alertdialog swallows Delete/Backspace and Cmd/Ctrl+Z for its own
 *  purpose (closing, picking an item) — the canvas underneath must not also react. Covers History,
 *  Trusted sources and Save draft (dialog); AddNodeMenu and the WorkflowListPane row menu (menu);
 *  a Select, e.g. AgentNodeFields' agent picker (listbox); F4 review round 1, Minor #2. */
const BLOCKING_OVERLAY_SELECTOR =
  '[role="dialog"], [role="menu"], [role="listbox"], [role="alertdialog"]'

/** An in-progress text edit, or any of the overlays above. */
export function shouldIgnoreWorkflowEditorShortcut(target: EventTarget | null): boolean {
  return isEditableTarget(target) || document.querySelector(BLOCKING_OVERLAY_SELECTOR) !== null
}

export type UseWorkflowEditorKeyboardShortcutsOptions = {
  /** False while no workflow is open — the listener is skipped entirely, not just inert. */
  enabled: boolean
  canDelete: boolean
  canUndo: boolean
  onDelete: () => void
  onUndo: () => void
}

/** Wires Delete/Backspace and Cmd/Ctrl+Z to the editor (F4) — `use-workflow-editor-state.ts`
 *  already supported delete and undo, nothing in the UI ever dispatched them. */
export function useWorkflowEditorKeyboardShortcuts({
  enabled,
  canDelete,
  canUndo,
  onDelete,
  onUndo
}: UseWorkflowEditorKeyboardShortcutsOptions): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (shouldIgnoreWorkflowEditorShortcut(event.target)) {
        return
      }
      if (canDelete && isWorkflowEditorDeleteShortcut(event)) {
        event.preventDefault()
        onDelete()
        return
      }
      if (canUndo && isWorkflowEditorUndoShortcut(event)) {
        event.preventDefault()
        onUndo()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [enabled, canDelete, canUndo, onDelete, onUndo])
}
