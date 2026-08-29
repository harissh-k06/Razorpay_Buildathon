"use client"

import React, { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { Button } from "@/components/ui/button"
import { ArrowLeftIcon, AlertCircleIcon } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const MESSAGES = [
  "Initiating standardisation pipeline and preparing your data...",
  "Connecting to the AI standardisation engine and batching records...",
  "Parsing file structure and extracting transaction data via MCP...",
  "Standardising vendor names and cleaning descriptions using AI...",
  "Extracting dates and amounts from transaction data...",
  "Detecting currencies and converting all amounts to base accounting currency...",
  "Finalising standardised data streams for reconciliation...",
  "Preparing your preview – redirecting to review...",
]

export default function StandardizePage() {
  const router = useRouter()
  const { standardizationStatus, standardizationDuration, error, savedPaths, baseCurrency, standardize } =
    useReconciliationStore()

  const [mounted, setMounted] = useState(false)
  const [msgIndex, setMsgIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const startedRef = useRef(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Guard: if no files uploaded, bounce back with message (after mount)
  useEffect(() => {
    if (mounted && !savedPaths.invoice && standardizationStatus === "idle") {
      toast({
        variant: "warning",
        title: "Files Required",
        description: "Please upload CSV files first.",
      })
      router.replace("/reconciliation/upload")
    }
  }, [mounted, savedPaths.invoice, standardizationStatus, router])

  // Kick off standardization once on mount
  useEffect(() => {
    if (mounted && !startedRef.current && savedPaths.invoice) {
      startedRef.current = true
      standardize(baseCurrency)
    }
  }, [mounted, savedPaths.invoice, baseCurrency, standardize])

  // Navigate forward when done (after brief success flash)
  useEffect(() => {
    if (standardizationStatus === "completed") {
      const timer = setTimeout(() => router.push("/reconciliation/review"), 1200)
      return () => clearTimeout(timer)
    }
  }, [standardizationStatus, router])

  // Single-cycle message progression while running
  useEffect(() => {
    if (standardizationStatus !== "running" && standardizationStatus !== "idle") return

    let isMounted = true
    const timeouts: NodeJS.Timeout[] = []

    const scheduleNext = (currentIndex: number) => {
      if (currentIndex >= MESSAGES.length - 1) {
        setVisible(true)
        return
      }

      const DISPLAY_TIME = 2200 // Time message stays fully visible
      const FADE_TIME = 300     // Fade duration

      const t1 = setTimeout(() => {
        if (!isMounted) return
        setVisible(false) // Start fade-out

        const t2 = setTimeout(() => {
          if (!isMounted) return
          setMsgIndex(currentIndex + 1)
          setVisible(true) // Start fade-in
          scheduleNext(currentIndex + 1)
        }, FADE_TIME)

        timeouts.push(t2)
      }, DISPLAY_TIME)

      timeouts.push(t1)
    }

    scheduleNext(0)

    return () => {
      isMounted = false
      timeouts.forEach(clearTimeout)
    }
  }, [standardizationStatus])

  const isCompleted = mounted && standardizationStatus === "completed"
  const isError     = mounted && standardizationStatus === "error"

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
      {isError ? (
        <div className="max-w-md space-y-4">
          <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10 mx-auto">
            <AlertCircleIcon className="size-8 text-destructive" />
          </div>
          <h2 className="text-xl font-bold text-text-primary">Standardization Failed</h2>
          <p className="text-sm text-text-muted">{error}</p>
          <Button variant="outline" onClick={() => router.push("/reconciliation/upload")}>
            <ArrowLeftIcon className="mr-2 size-4" /> Go Back
          </Button>
        </div>
      ) : isCompleted ? (
        <div className="max-w-md space-y-4">
          <div className="flex size-16 items-center justify-center rounded-full bg-success/10 mx-auto">
            <span className="text-3xl text-success">✓</span>
          </div>
          <h2 className="text-xl font-bold text-text-primary">Standardization Complete</h2>
          {standardizationDuration !== null && (
            <p className="text-sm text-text-muted">Completed in {standardizationDuration}s — redirecting to review...</p>
          )}
        </div>
      ) : (
        /* Running state */
        <div className="max-w-lg space-y-10">
          {/* Animated spinner */}
          <div className="relative mx-auto flex size-24 items-center justify-center">
            <span className="absolute inset-0 rounded-full border-4 border-primary/20" />
            <span className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin" />
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
              <svg className="size-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight text-text-primary mb-2">
              AI Standardisation Running
            </h2>
            <p className="text-sm text-text-muted">
              The AI standardisation pipeline is normalising and preparing your transaction streams.
            </p>
          </div>

          {/* Fading message */}
          <div className="min-h-[48px] flex items-center justify-center">
            <p
              className={cn(
                "text-sm font-medium text-primary transition-opacity duration-300",
                visible ? "opacity-100" : "opacity-0"
              )}
            >
              {MESSAGES[msgIndex]}
            </p>
          </div>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2">
            {MESSAGES.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "block size-2 rounded-full transition-all duration-500",
                  i === msgIndex ? "bg-primary scale-125" : "bg-primary/20"
                )}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
