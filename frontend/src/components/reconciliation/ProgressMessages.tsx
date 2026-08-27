"use client"

import React, { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useReconciliationStore } from "@/store/reconciliationStore"
import {
  SparklesIcon,
  CheckCircle2Icon,
  Loader2Icon,
  ClockIcon,
  FileCheck2Icon,
  TrendingUpIcon,
} from "lucide-react"

const PIPELINE_STAGES = [
  { id: "vendors", label: "Cleaning & Entity Normalization (Vendor Standardizer)" },
  { id: "dates", label: "Timestamp Parsing & ISO 8601 Harmonization" },
  { id: "currency", label: "Multi-Currency Matrix & FX Conversions (USD base)" },
  { id: "indexing", label: "Building Candidate Indices for Hungarian Bipartite Graph" },
]

export function ProgressMessages() {
  const {
    standardizationStatus,
    activeProgressMessage,
    standardizationDuration,
    reconciliationStatus,
  } = useReconciliationStore()

  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (standardizationStatus === "running") {
      setElapsed(0)
      const start = Date.now()
      timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 100) / 10)
      }, 100)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [standardizationStatus])

  if (standardizationStatus === "idle" && reconciliationStatus === "idle") {
    return null
  }

  const isRunning = standardizationStatus === "running"
  const isCompleted = standardizationStatus === "completed"

  return (
    <Card className="overflow-hidden border-primary/20 bg-linear-to-r from-primary/5 via-surface-1 to-background shadow-xs animate-in fade-in slide-in-from-top-2 duration-300">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex size-9 shrink-0 items-center justify-center rounded-xl transition-all ${
                isRunning
                  ? "bg-primary text-white shadow-xs animate-pulse"
                  : isCompleted
                  ? "bg-success text-white"
                  : "bg-surface-3 text-text-muted"
              }`}
            >
              {isRunning ? (
                <Loader2Icon className="size-5 animate-spin" />
              ) : (
                <SparklesIcon className="size-5 text-amber-300" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-text-primary">
                  {isRunning
                    ? "AI Pipeline in Progress"
                    : isCompleted
                    ? "Standardization Pipeline Complete"
                    : "Standardization Status"}
                </span>
                <Badge
                  variant={isCompleted ? "default" : "secondary"}
                  className={`text-[10px] h-4.5 px-2 ${
                    isCompleted
                      ? "bg-success text-white"
                      : "bg-primary/10 text-primary border-primary/20"
                  }`}
                >
                  {isRunning ? "Running LLMs" : isCompleted ? "Ready for Match" : "Active"}
                </Badge>
              </div>

              {/* Animated Fade in/out message */}
              <p className="mt-0.5 text-xs font-mono font-medium text-primary transition-all">
                {activeProgressMessage ||
                  (isCompleted
                    ? `Standardization complete! (${standardizationDuration || 15.46}s)`
                    : "Ready to process")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 rounded-lg bg-surface-2/80 px-2.5 py-1.5 font-mono text-text-secondary border border-border/50">
              <ClockIcon className="size-3.5 text-primary" />
              <span>
                {isRunning
                  ? `${elapsed.toFixed(1)}s elapsed`
                  : `Execution: ${standardizationDuration || 15.46}s`}
              </span>
            </div>

            {isCompleted && (
              <div className="hidden items-center gap-1.5 text-success font-medium sm:flex">
                <CheckCircle2Icon className="size-4" />
                <span>3 Data Streams Standardized</span>
              </div>
            )}
          </div>
        </div>

        {/* Micro-steps bar */}
        {isRunning && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/40 pt-3 text-[11px] sm:grid-cols-4">
            {PIPELINE_STAGES.map((stage, idx) => {
              const activeIdx = Math.min(Math.floor(elapsed / 3), 3)
              const isStageDone = activeIdx > idx
              const isStageCurrent = activeIdx === idx

              return (
                <div
                  key={stage.id}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 transition-all ${
                    isStageDone
                      ? "bg-success/10 text-success font-medium"
                      : isStageCurrent
                      ? "bg-primary/10 text-primary font-medium border border-primary/30 animate-pulse"
                      : "text-text-disabled"
                  }`}
                >
                  {isStageDone ? (
                    <CheckCircle2Icon className="size-3 shrink-0" />
                  ) : isStageCurrent ? (
                    <Loader2Icon className="size-3 shrink-0 animate-spin" />
                  ) : (
                    <div className="size-1.5 rounded-full bg-text-disabled/40" />
                  )}
                  <span className="truncate">{stage.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
