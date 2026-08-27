"use client"

import React from "react"
import { useToast, dismissToast, ToastItem } from "@/hooks/use-toast"
import { AlertCircleIcon, AlertTriangleIcon, CheckCircle2Icon, InfoIcon, XIcon } from "lucide-react"

export function Toaster() {
  const { toasts } = useToast()

  if (!toasts.length) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((t: ToastItem) => {
        const isDestructive = t.variant === "destructive"
        const isWarning = t.variant === "warning"
        const isSuccess = t.variant === "success"

        const borderBg = isDestructive
          ? "border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/20"
          : isWarning
          ? "border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          : isSuccess
          ? "border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          : "border-[#0C2651]/30 bg-[#0C2651] text-white shadow-lg"

        const Icon = isDestructive
          ? AlertCircleIcon
          : isWarning
          ? AlertTriangleIcon
          : isSuccess
          ? CheckCircle2Icon
          : InfoIcon

        const iconColor = isDestructive
          ? "text-destructive"
          : isWarning
          ? "text-amber-600 dark:text-amber-400"
          : isSuccess
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-[#0D94FB]"

        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-md transition-all duration-300 animate-in slide-in-from-bottom-2 ${borderBg}`}
          >
            <Icon className={`size-5 shrink-0 mt-0.5 ${iconColor}`} />
            <div className="flex-1 space-y-0.5">
              {t.title && <p className="text-xs font-bold leading-tight">{t.title}</p>}
              <p className="text-xs leading-relaxed opacity-95">{t.description}</p>
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="size-5 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
