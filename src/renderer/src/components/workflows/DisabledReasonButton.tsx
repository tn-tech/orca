import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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
 * The shared "disabled, but say why" control for Run/Save/History/Undo. `aria-disabled` (not
 * `disabled`) plus a click guard keeps it focusable and hoverable — a native `disabled` button
 * drops out of the tab order and, in Chromium, blocks the pointer events a Tooltip needs
 * (`FileExplorerToolbar.tsx`).
 *
 * The Tooltip stays mounted at every render, with only its `open` state or content changing;
 * swapping between a bare `<Button>` and a `<Tooltip>`-wrapped one on reason changes would
 * remount the button and drop focus (e.g. Enter on Save while dirty, which un-dirties it). `open`
 * stays a controlled boolean throughout (never `undefined`) — flipping between controlled and
 * uncontrolled trips a Radix dev warning on every reason change. It also tracks hover/focus alone,
 * never gated on content: Radix's `useControllableState` only calls `onOpenChange` when the value
 * it wants differs from the current `open` prop, so a prop computed as `open && hasContent` gets
 * stuck — while there's no content the prop is always `false`, so a pointer-leave (wanting `false`,
 * already `false`) never round-trips back to local state, and a later reason can pop the stale
 * `open` open with no hover at all. `TooltipContent` itself is the thing gated on content, so
 * hovering an enabled control with nothing to say never opens anything, without desyncing `open`.
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
  const [open, setOpen] = useState(false)

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          aria-disabled={disabled}
          softDisabled={disabled}
          className={className}
          onClick={(event) => {
            if (disabled) {
              event.preventDefault()
              return
            }
            onClick()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      {tooltipContent !== undefined ? (
        <TooltipContent side={tooltipSide} sideOffset={4}>
          {tooltipContent}
        </TooltipContent>
      ) : null}
    </Tooltip>
  )
}
