import React from 'react'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export type UndoButtonProps = {
  canUndo: boolean
  /** F4: a run in progress must not have its backing definition mutated out from under it. */
  disabled?: boolean
  onUndo: () => void
}

/** Toolbar Undo (F4) — `use-workflow-editor-state.ts` already kept a 50-entry history, nothing in
 *  the UI ever dispatched `undo`. The keyboard shortcut (Cmd/Ctrl+Z) lives in
 *  `workflow-editor-keyboard-shortcuts.ts`; this button is the discoverable, mouse-only path. */
export default function UndoButton({
  canUndo,
  disabled,
  onUndo
}: UndoButtonProps): React.JSX.Element {
  const isDisabled = !canUndo || disabled === true

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isDisabled}
      title={
        disabled
          ? translate(
              'auto.components.workflows.editor.UndoButton.disabledDuringRun',
              'Undo is disabled while a run is shown.'
            )
          : undefined
      }
      onClick={onUndo}
    >
      <Undo2 />
      {translate('auto.components.workflows.editor.UndoButton.trigger', 'Undo')}
    </Button>
  )
}
