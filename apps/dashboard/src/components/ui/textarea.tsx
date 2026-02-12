import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground shadow-sm transition-all duration-200 resize-none",
        "placeholder:text-muted-foreground",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring",
        "hover:border-muted-foreground/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
