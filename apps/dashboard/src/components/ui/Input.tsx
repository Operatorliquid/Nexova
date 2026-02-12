import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "./label"

type InputProps = React.ComponentProps<"input"> & {
  label?: string
  hint?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, hint, id, name, ...props }, ref) => {
    const generatedId = React.useId()
    const inputId = id ?? name ?? (label || hint ? generatedId : undefined)

    const inputElement = (
      <input
        id={inputId}
        type={type}
        className={cn(
          "flex h-10 w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm transition-all duration-200",
          "placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring",
          "hover:border-muted-foreground/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className
        )}
        ref={ref}
        {...props}
      />
    )

    if (!label && !hint) {
      return inputElement
    }

    return (
      <div className="space-y-2">
        {label ? (
          <Label htmlFor={inputId} className="text-foreground">
            {label}
          </Label>
        ) : null}
        {inputElement}
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input }
