import React from 'react'
import { Undo2 } from 'lucide-react'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { getShortcutPlatform } from '@/lib/shortcut-platform'

export type UndoButtonProps = {
  canUndo: boolean
  onUndo: () => void
}

/** Toolbar Undo (F4) — `use-workflow-editor-state.ts` already kept a 50-entry history, nothing in
 *  the UI ever dispatched `undo`. The keyboard shortcut (Cmd/Ctrl+Z) lives in
 *  `workflow-editor-keyboard-shortcuts.ts`; this button is the discoverable, mouse-only path. A
 *  Tooltip (not a `title` attr) surfaces the shortcut as a `<ShortcutKeyCombo />` chip, per
 *  STYLEGUIDE's "Shortcut chips inside tooltips" rule — F4 review round 1. Undo follows every
 *  other edit's rule for a shown run (not blocked; see `use-workflows-page-controller.ts`), so
 *  the only disabled state left is "nothing to undo".
 */
export default function UndoButton({ canUndo, onUndo }: UndoButtonProps): React.JSX.Element {
  const isMac = getShortcutPlatform() === 'darwin'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={!canUndo} onClick={onUndo}>
          <Undo2 />
          {translate('auto.components.workflows.editor.UndoButton.trigger', 'Undo')}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {translate('auto.components.workflows.editor.UndoButton.trigger', 'Undo')}
        <ShortcutKeyCombo keys={isMac ? ['⌘', 'Z'] : ['Ctrl', 'Z']} className="ml-1.5" />
      </TooltipContent>
    </Tooltip>
  )
}
