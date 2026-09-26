import React from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Stacked label-over-control layout; the inspector is a narrow sidebar where a side-by-side
 *  row (like `SettingsRow`) leaves too little room for the prompt/JSON editor controls. Pass
 *  `htmlFor` (matching the control's `id`) whenever the field wraps a single Input/Textarea so
 *  the label is programmatically associated with it. */
export function InspectorField({
  label,
  htmlFor,
  children,
  className
}: {
  label: React.ReactNode
  htmlFor?: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}
