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
 *
 *  F5: that disabled state used to give no reason. A native `disabled` button also loses pointer
 *  events in Chromium (hides this Tooltip) and drops out of the tab order (hides the reason from
 *  screen readers) — same fix as `action-button.tsx`: `aria-disabled` plus a click guard, not
 *  `disabled`.
 */
export default function UndoButton({ canUndo, onUndo }: UndoButtonProps): React.JSX.Element {
  const isMac = getShortcutPlatform() === 'darwin'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={!canUndo}
          // Inline style, not a class: <Button>'s contract owns opacity (shadcn/no-restyle), and
          // `disabled:opacity-50` never triggers since `disabled` is deliberately unset above.
          style={!canUndo ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          onClick={(event) => {
            if (!canUndo) {
              event.preventDefault()
              return
            }
            onUndo()
          }}
        >
          <Undo2 />
          {translate('auto.components.workflows.editor.UndoButton.trigger', 'Undo')}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {canUndo ? (
          <>
            {translate('auto.components.workflows.editor.UndoButton.trigger', 'Undo')}
            <ShortcutKeyCombo keys={isMac ? ['⌘', 'Z'] : ['Ctrl', 'Z']} className="ml-1.5" />
          </>
        ) : (
          translate(
            'auto.components.workflows.editor.UndoButton.nothingToUndo',
            'Nothing to undo yet.'
          )
        )}
      </TooltipContent>
    </Tooltip>
  )
}
