import * as React from "react"
import { cn } from "@/lib/utils"

interface ScrollAreaProps extends React.ComponentProps<"div"> {
  className?: string
  children?: React.ReactNode
}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="scroll-area"
        className={cn("relative overflow-y-auto overflow-x-hidden", className)}
        {...props}
      >
        {children}
      </div>
    )
  }
)
ScrollArea.displayName = "ScrollArea"

export { ScrollArea }
