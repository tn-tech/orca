import React from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type DisabledReasonButtonProps = {
  /** Set to explain why the control is disabled; `undefined` means enabled. */
  reason: string | undefined
  /** Shown on hover/focus while enabled (e.g. Undo's shortcut chip). Omit for no tooltip. */
  enabledTooltip?: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  tooltipSide?: 'top' | 'bottom'
  className?: string
}

/**
 * F5 fix round 1: the shared "disabled, but say why" control for Run/Save/History/Undo,
 * replacing four pasted-verbatim copies. `aria-disabled` (not `disabled`) plus a click guard
 * keeps it focusable and hoverable — a native `disabled` button drops out of the tab order and,
 * in Chromium, blocks the pointer events a Tooltip needs (`FileExplorerToolbar.tsx`).
 *
 * The Tooltip stays mounted at every render, with only its `open` state or content changing;
 * swapping between a bare `<Button>` and a `<Tooltip>`-wrapped one on reason changes would
 * remount the button and drop focus (e.g. Enter on Save while dirty, which un-dirties it).
 *
 * `Button` owns its color/effects classes (shadcn/no-restyle), so the dimming lives on a plain
 * inner `<span>` instead — that rule only checks recognized design-system components, not native
 * elements. `cursor-not-allowed` is layout-exempt and goes straight on the `<Button>`.
 */
export default function DisabledReasonButton({
  reason,
  enabledTooltip,
  onClick,
  children,
  variant,
  size = 'sm',
  tooltipSide = 'top',
  className
}: DisabledReasonButtonProps): React.JSX.Element {
  const disabled = reason !== undefined
  const tooltipContent = reason ?? enabledTooltip

  return (
    <Tooltip open={tooltipContent === undefined ? false : undefined}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          aria-disabled={disabled}
          className={cn(disabled && 'cursor-not-allowed', className)}
          onClick={(event) => {
            if (disabled) {
              event.preventDefault()
              return
            }
            onClick()
          }}
        >
          <span className={cn('inline-flex items-center gap-1.5', disabled && 'opacity-50')}>
            {children}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} sideOffset={4}>
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  )
}
