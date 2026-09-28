import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md cursor-pointer text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        outline:
          'border border-border bg-background text-foreground shadow-xs hover:border-muted-foreground/35 hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-10'
      },
      // Opt-in "explains why on hover, but stays focusable" look for a control a caller disables
      // via aria-disabled instead of `disabled` (which drops it from the tab order and, in
      // Chromium, blocks the pointer events a Tooltip needs). Off by default, so no existing
      // Button changes; a caller sets it explicitly (see DisabledReasonButton).
      softDisabled: {
        true: 'cursor-not-allowed opacity-50',
        false: ''
      }
    },
    // Each variant's own resting background/text, reapplied under `hover:` so a soft-disabled
    // button doesn't look interactive on hover.
    compoundVariants: [
      { variant: 'default', softDisabled: true, class: 'hover:bg-primary' },
      {
        variant: 'destructive',
        softDisabled: true,
        class: 'hover:bg-destructive dark:hover:bg-destructive/60'
      },
      {
        variant: 'outline',
        softDisabled: true,
        class:
          'hover:border-border hover:bg-background hover:text-foreground dark:hover:bg-input/30'
      },
      { variant: 'secondary', softDisabled: true, class: 'hover:bg-secondary' },
      {
        variant: 'ghost',
        softDisabled: true,
        class: 'hover:bg-transparent hover:text-foreground dark:hover:bg-transparent'
      },
      { variant: 'link', softDisabled: true, class: 'hover:no-underline' }
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
      softDisabled: false
    }
  }
)

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean
    }
>(function Button(
  {
    className,
    variant = 'default',
    size = 'default',
    softDisabled = false,
    asChild = false,
    ...props
  },
  ref
) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, softDisabled, className }))}
      {...props}
    />
  )
})

export { Button, buttonVariants }
