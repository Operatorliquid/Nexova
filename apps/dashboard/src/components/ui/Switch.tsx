import * as React from "react"

import { cn } from "@/lib/utils"

type SwitchProps = Omit<React.ComponentProps<"input">, "type"> & {
  label?: string
  description?: string
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, description, id, name, ...props }, ref) => {
    const generatedId = React.useId()
    const inputId = id ?? name ?? generatedId

    const toggle = (
      <label htmlFor={inputId} className="relative inline-flex items-center cursor-pointer">
        <input
          id={inputId}
          ref={ref}
          type="checkbox"
          className="sr-only peer"
          {...props}
        />
        <div
          className={cn(
            "w-11 h-6 rounded-full transition-colors",
            "bg-secondary peer-checked:bg-primary",
            "after:content-[''] after:absolute after:top-[2px] after:left-[2px]",
            "after:bg-white dark:after:bg-slate-200 after:rounded-full after:h-5 after:w-5",
            "after:transition-all peer-checked:after:translate-x-full",
            className
          )}
        />
      </label>
    )

    if (!label) return toggle

    return (
      <div className="flex items-center justify-between p-4 rounded-xl bg-secondary border border-border">
        <div>
          <p className="font-medium text-sm text-foreground">{label}</p>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {toggle}
      </div>
    )
  }
)
Switch.displayName = "Switch"

export { Switch }
