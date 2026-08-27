"use client"

import React from "react"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { cn } from "@/lib/utils"

interface AgenticToggleProps {
  className?: string
  showLabel?: boolean
  compact?: boolean
  showDescription?: boolean
}

export function AgenticToggle({
  className,
  showLabel = true,
}: AgenticToggleProps) {
  const agenticMode = useReconciliationStore((state) => state.agenticMode)
  const setAgenticMode = useReconciliationStore((state) => state.setAgenticMode)

  const handleToggle = () => {
    setAgenticMode(!agenticMode)
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 h-9 bg-transparent select-none shrink-0 px-1",
        className
      )}
      title={
        agenticMode
          ? "Agentic Mode (ON): Write & action tools execute automatically."
          : "Ask Mode (OFF): Write & action tools are locked until Agentic Mode is enabled (green toggle)."
      }
    >
      {showLabel && (
        <span
          onClick={handleToggle}
          className={cn(
            "w-[58px] text-right text-sm font-semibold tracking-tight transition-colors cursor-pointer select-none pr-0.5",
            agenticMode
              ? "text-emerald-600 dark:text-emerald-400 font-bold"
              : "text-amber-500 dark:text-amber-400 font-bold"
          )}
        >
          {agenticMode ? "Agentic" : "Ask"}
        </span>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={agenticMode}
        onClick={handleToggle}
        className={cn(
          "relative inline-flex h-[22px] w-[40px] shrink-0 cursor-pointer rounded-full p-[2px] transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
          agenticMode
            ? "bg-emerald-500 hover:bg-emerald-600 shadow-xs"
            : "bg-amber-400 hover:bg-amber-500 shadow-xs"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block size-[18px] transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
            agenticMode ? "translate-x-[18px]" : "translate-x-0"
          )}
        />
      </button>
    </div>
  )
}
