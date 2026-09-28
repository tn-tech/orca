import React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export type SaveWorkflowButtonProps = {
  dirty: boolean
  isDraft: boolean
  saving: boolean
  /** FR-009: a blocking validation error also gates Save (`WorkflowsPage.tsx`). */
  blockingProblems: boolean
  onClick: () => void
}

/** F5: Save's disabled state used to give no reason (audit `WorkflowsPage.tsx:96-108`). A native
 *  `disabled` button also loses pointer events in Chromium (hides a Radix Tooltip) and drops out
 *  of the tab order (hides the reason from screen readers) — same fix as `action-button.tsx`:
 *  `aria-disabled` plus a click guard, not `disabled`. Extracted out of `WorkflowsPage.tsx` to
 *  keep that file under the 400-line `.tsx` budget and make the reason logic independently
 *  testable. */
export default function SaveWorkflowButton({
  dirty,
  isDraft,
  saving,
  blockingProblems,
  onClick
}: SaveWorkflowButtonProps): React.JSX.Element {
  const disabled = (!dirty && !isDraft) || saving || blockingProblems
  const reason = blockingProblems
    ? translate(
        'auto.components.workflows.WorkflowsPage.saveBlocked',
        'Fix the problems below before saving.'
      )
    : !dirty && !isDraft
      ? translate(
          'auto.components.workflows.SaveWorkflowButton.nothingToSave',
          'No changes to save yet.'
        )
      : undefined

  const button = (
    <Button
      type="button"
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
      {saving ? <Loader2 className="animate-spin" /> : null}
      {translate('auto.components.workflows.WorkflowsPage.save', 'Save')}
    </Button>
  )

  if (reason === undefined) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {reason}
      </TooltipContent>
    </Tooltip>
  )
}
