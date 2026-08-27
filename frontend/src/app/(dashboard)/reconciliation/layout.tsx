"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import {
  CheckCircle2Icon,
  UploadCloudIcon,
  SparklesIcon,
  ScanSearchIcon,
  BarChart3Icon,
  Loader2,
  X,
} from "lucide-react"
import { PennyWiseChat } from "@/components/chatbot/PennyWiseChat"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { cn } from "@/lib/utils"

const STEPS = [
  { label: "Upload",      href: "/reconciliation/upload",      icon: UploadCloudIcon  },
  { label: "Standardize", href: "/reconciliation/standardize", icon: SparklesIcon     },
  { label: "Review",      href: "/reconciliation/review",      icon: ScanSearchIcon   },
  { label: "Results",     href: "/reconciliation/results",     icon: BarChart3Icon    },
]

export default function ReconciliationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const currentStep = STEPS.findIndex((s) => pathname.startsWith(s.href))

  const storeLoadData = useReconciliationStore((state) => state.loadData)
  const storeStandardize = useReconciliationStore((state) => state.standardize)
  const storeReconcile = useReconciliationStore((state) => state.reconcile)

  // Floating Action Status / Toast state
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingMessage, setProcessingMessage] = useState("")
  const [isFadingOut, setIsFadingOut] = useState(false)
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null)

  const dismissNotification = useCallback(() => {
    setIsFadingOut(true)
    setTimeout(() => {
      setIsProcessing(false)
      setIsFadingOut(false)
      setProcessingMessage("")
    }, 300)
  }, [])

  const handleActionTriggered = useCallback(
    async (action: string, target?: string) => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current)
      }

      setIsFadingOut(false)

      if (action === "reconcile") {
        setProcessingMessage("PennyWise is running reconciliation & updating results...")
        setIsProcessing(true)
        router.push("/reconciliation/results")

        if (typeof storeReconcile === "function") {
          await storeReconcile()
        }
      } else if (action === "standardize") {
        const currencyText = target ? ` to ${target.toUpperCase()}` : ""
        setProcessingMessage(`PennyWise is re-standardizing data${currencyText}...`)
        setIsProcessing(true)
        router.push("/reconciliation/standardize")

        if (typeof storeStandardize === "function") {
          await storeStandardize(target || "INR")
        }
      } else if (action === "review" || action === "bulk_update" || action === "data_updated") {
        setProcessingMessage("PennyWise updated transaction records. Refreshing data...")
        setIsProcessing(true)
        if (!pathname.startsWith("/reconciliation/review")) {
          router.push("/reconciliation/review")
        }

        if (typeof storeLoadData === "function") {
          await storeLoadData()
        }
      }

      // Auto dismiss status toast after 4.5 seconds
      dismissTimerRef.current = setTimeout(() => {
        dismissNotification()
      }, 4500)
    },
    [pathname, router, storeLoadData, storeStandardize, storeReconcile, dismissNotification]
  )

  // Also listen to global browser event if dispatched from deep components
  useEffect(() => {
    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ action: string; target?: string }>
      if (customEvent.detail?.action) {
        handleActionTriggered(customEvent.detail.action, customEvent.detail.target)
      }
    }

    const handleRefreshEvent = () => {
      if (typeof storeLoadData === "function") {
        storeLoadData()
      }
    }

    window.addEventListener("pennywise:action", handleCustomEvent)
    window.addEventListener("pennywise:data_refresh", handleRefreshEvent)
    return () => {
      window.removeEventListener("pennywise:action", handleCustomEvent)
      window.removeEventListener("pennywise:data_refresh", handleRefreshEvent)
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [handleActionTriggered, storeLoadData])

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* Floating Status Notification / Toast Overlay */}
      {isProcessing && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
          <div
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 rounded-full bg-white/95 border border-blue-200/80 text-slate-800 shadow-xl backdrop-blur-md transition-all duration-300",
              isFadingOut
                ? "animate-out fade-out slide-out-to-top-4 duration-300 opacity-0"
                : "animate-in fade-in slide-in-from-top-4 duration-300"
            )}
          >
            <div className="relative flex size-6.5 shrink-0 items-center justify-center rounded-full overflow-hidden border border-blue-300 shadow-2xs">
              <img
                src="/penny-wise-avatar.png"
                alt="PennyWise"
                className="size-full object-cover"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 uppercase tracking-wider">
                PennyWise
              </span>
              <span className="text-xs sm:text-sm font-medium text-slate-800 pr-1">
                {processingMessage}
              </span>
            </div>

            <button
              onClick={dismissNotification}
              className="rounded-full p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors ml-1 cursor-pointer"
              aria-label="Dismiss Notification"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div className="shrink-0 border-b border-border/60 bg-background/95 backdrop-blur px-6 py-3">
        <nav className="flex items-center gap-0">
          {STEPS.map((step, i) => {
            const Icon = step.icon
            const isActive  = pathname.startsWith(step.href)
            const isDone    = i < currentStep
            const isLast    = i === STEPS.length - 1
            return (
              <React.Fragment key={step.href}>
                <Link
                  href={step.href}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "text-[#0D94FB] bg-[#0D94FB]/10 font-semibold"
                      : isDone
                      ? "text-success"
                      : "text-text-muted hover:text-text-secondary"
                  )}
                >
                  {isDone
                    ? <CheckCircle2Icon className="size-4 shrink-0 text-success" />
                    : <Icon className={cn("size-4 shrink-0", isActive ? "text-[#0D94FB]" : "text-text-disabled")} />
                  }
                  <span className="hidden sm:inline">{step.label}</span>
                </Link>
                {!isLast && (
                  <span className="mx-1 text-text-disabled/60 select-none text-xs">›</span>
                )}
              </React.Fragment>
            )
          })}
        </nav>
      </div>

      {/* Page content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {children}
      </div>

      {/* Persistent Floating PennyWise AI Assistant across Reconciliation pages */}
      <PennyWiseChat onActionTriggered={handleActionTriggered} />
    </div>
  )
}
