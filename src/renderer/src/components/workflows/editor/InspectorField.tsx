import React from 'react'
import { cn } from '@/lib/utils'

/** Stacked label-over-control layout; the inspector is a narrow sidebar where a side-by-side
 *  row (like `SettingsRow`) leaves too little room for the prompt/JSON editor controls. */
export function InspectorField({
  label,
  children,
  className
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}
