import React from 'react'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export type RunHistoryButtonProps = {
  /** No saved run target yet: no open workflow file, or no active project repo. */
  disabled: boolean
  onClick: () => void
}

/** F5: History's disabled state used to give no reason (audit `WorkflowsPage.tsx:200`). Same
 *  `aria-disabled` + click-guard fix as `SaveWorkflowButton` (a native `disabled` button hides
 *  the Tooltip on hover in Chromium and drops out of the tab order, hiding the reason from
 *  screen readers). */
export default function RunHistoryButton({
  disabled,
  onClick
}: RunHistoryButtonProps): React.JSX.Element {
  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={disabled}
      // Inline style, not a class: <Button>'s contract owns opacity (shadcn/no-restyle), and
      // `disabled:opacity-50` never triggers since `disabled` is deliberately unset above.
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault()
          return
        }
        onClick()
      }}
    >
      <History />
      {translate('auto.components.workflows.WorkflowsPage.runHistory', 'History')}
    </Button>
  )

  if (!disabled) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {translate(
          'auto.components.workflows.WorkflowsPage.historyBlocked',
          'Save the workflow first.'
        )}
      </TooltipContent>
    </Tooltip>
  )
}
