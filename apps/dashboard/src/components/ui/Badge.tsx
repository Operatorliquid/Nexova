import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium transition-all",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/15 text-primary",
        secondary:
          "border-border bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive/15 text-destructive",
        success:
          "border-transparent bg-emerald-500/15 text-emerald-500",
        info:
          "border-transparent bg-cyan-500/15 text-cyan-400",
        warning:
          "border-transparent bg-amber-500/15 text-amber-500",
        outline:
          "border-border text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
