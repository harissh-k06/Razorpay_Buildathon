"use client"

import React from "react"
import { FileUpload } from "@/components/reconciliation/FileUpload"
import { ProgressMessages } from "@/components/reconciliation/ProgressMessages"
import { KPICards } from "@/components/reconciliation/KPICards"
import { DataPreview } from "@/components/reconciliation/DataPreview"
import { ResultsTable } from "@/components/reconciliation/ResultsTable"
import { ExceptionsTable } from "@/components/reconciliation/ExceptionsTable"
import { ExceptionPieChart } from "@/components/reconciliation/ExceptionPieChart"
import { ReconciliationToast } from "@/components/reconciliation/ReconciliationToast"
import { useReconciliationStore } from "@/store/reconciliationStore"
import {
  SparklesIcon,
  ShieldCheckIcon,
  LayersIcon,
  BotIcon,
  HelpCircleIcon,
  ArrowRightIcon,
  ActivityIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"

export function ReconciliationDashboard() {
  const {
    uploadStatus,
    standardizationStatus,
    reconciliationStatus,
    results,
  } = useReconciliationStore()

  const hasUploaded = uploadStatus === "uploaded"
  const isStandardized = standardizationStatus === "completed"
  const isReconciled = reconciliationStatus === "completed"

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
      {/* Top Banner & Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-linear-to-r from-primary/10 via-surface-2 to-background p-6 border border-primary/20 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
              <BotIcon className="size-5" />
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-text-primary">
              AI Finance Controller
            </h1>
            <Badge variant="default" className="bg-primary text-white text-xs px-2 py-0.5 font-mono">
              Track 04
            </Badge>
          </div>
          <p className="text-xs md:text-sm text-text-muted">
            Autonomous 3-Way Transaction Reconciliation Engine using LLM Schema Normalization & Hungarian Bipartite Graph Matching.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <div className="flex items-center gap-1.5 rounded-lg bg-background px-3 py-1.5 border border-border/80 shadow-2xs">
            <span className="size-2 rounded-full bg-success animate-pulse" />
            <span className="text-text-secondary">Backend FastAPI:</span>
            <span className="font-mono text-success font-semibold">Active :8000</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg bg-background px-3 py-1.5 border border-border/80 shadow-2xs">
            <ShieldCheckIcon className="size-3.5 text-primary" />
            <span className="text-text-secondary">Deterministic FX:</span>
            <span className="font-mono text-primary font-semibold">USD Base</span>
          </div>
        </div>
      </div>

      {/* Section 1: Upload Area (Always visible) */}
      <FileUpload />

      {/* Section 3 (Animated): Progress Messages during standardization */}
      <ProgressMessages />

      {/* Section 3: KPI Metrics Cards (Visible after standardization / reconciliation) */}
      {(hasUploaded || isStandardized || isReconciled) && <KPICards />}

      {/* Section 6: Pie Chart & Financial Balance Summary (Visible after reconciliation) */}
      {isReconciled && <ExceptionPieChart />}

      {/* Section 2: Preview Tabs (After Upload) with Human Review Step */}
      {(hasUploaded || isStandardized) && <DataPreview />}

      {/* Section 4: Results Table (After Reconciliation) */}
      {isReconciled && <ResultsTable />}

      {/* Section 5: Exceptions Table (After Reconciliation) */}
      {isReconciled && <ExceptionsTable />}

      {/* Toast Notification Container */}
      <ReconciliationToast />
    </div>
  )
}
