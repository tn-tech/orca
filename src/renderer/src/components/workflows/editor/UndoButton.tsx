import React from 'react'
import { Undo2 } from 'lucide-react'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { translate } from '@/i18n/i18n'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import DisabledReasonButton from '../DisabledReasonButton'

export type UndoButtonProps = {
  canUndo: boolean
  onUndo: () => void
}

/** Toolbar Undo (F4) — `use-workflow-editor-state.ts` already kept a 50-entry history, nothing in
 *  the UI ever dispatched `undo`. The keyboard shortcut (Cmd/Ctrl+Z) lives in
 *  `workflow-editor-keyboard-shortcuts.ts`; this button is the discoverable, mouse-only path. Undo
 *  follows every other edit's rule for a shown run (not blocked), so the only disabled state left
 *  is "nothing to undo".
 */
export default function UndoButton({ canUndo, onUndo }: UndoButtonProps): React.JSX.Element {
  const isMac = getShortcutPlatform() === 'darwin'

  return (
    <DisabledReasonButton
      variant="outline"
      reason={
        canUndo
          ? undefined
          : translate(
              'auto.components.workflows.editor.UndoButton.nothingToUndo',
              'Nothing to undo yet.'
            )
      }
      enabledTooltip={
        <>
          {translate('auto.components.workflows.editor.UndoButton.trigger', 'Undo')}
          <ShortcutKeyCombo keys={isMac ? ['⌘', 'Z'] : ['Ctrl', 'Z']} className="ml-1.5" />
        </>
      }
      onClick={onUndo}
    >
      <Undo2 />
      {translate('auto.components.workflows.editor.UndoButton.trigger', 'Undo')}
    </DisabledReasonButton>
  )
}
