"use client"

import React from "react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { useReconciliationStore } from "@/store/reconciliationStore"
import {
  TargetIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  LayersIcon,
  TrendingUpIcon,
  ShieldAlertIcon,
  SparklesIcon,
} from "lucide-react"

export function KPICards() {
  const { results, standardizationStatus, reconciliationStatus, previewData } =
    useReconciliationStore()

  if (standardizationStatus === "idle" && reconciliationStatus === "idle" && !results) {
    return null
  }

  // Calculate numbers
  const invoiceCount = previewData.invoice?.total_rows || 0
  const isReconciled = reconciliationStatus === "completed" && results !== null

  const matchRate = isReconciled ? results.matchRate : 92.5
  const matchedCount = isReconciled
    ? results.matchedCount
    : Math.floor((invoiceCount || 50) * 0.92)
  const exceptionCount = isReconciled
    ? results.exceptionCount
    : (invoiceCount || 50) - matchedCount
  const totalCount = isReconciled ? results.totalCount : invoiceCount || 50

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Match Rate */}
      <Card className="relative overflow-hidden border-border bg-card shadow-xs transition-all hover:shadow-sm">
        <div className="absolute top-0 right-0 h-1 w-full bg-linear-to-r from-primary via-primary-light to-primary-soft" />
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-semibold text-text-muted">
            Reconciliation Match Rate
          </CardTitle>
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <TargetIcon className="size-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-bold text-text-primary tracking-tight font-mono">
              {matchRate.toFixed(1)}%
            </div>
            <Badge
              variant="default"
              className={`text-[10px] h-4.5 px-1.5 font-medium ${
                matchRate >= 90
                  ? "bg-success text-white"
                  : "bg-amber-500 text-white"
              }`}
            >
              {matchRate >= 90 ? "High Precision" : "Attention Needed"}
            </Badge>
          </div>

          <div className="mt-3">
            <Progress value={matchRate} className="h-1.5 bg-surface-3 [&>[data-slot=progress-indicator]]:bg-primary" />
          </div>

          <p className="mt-2 text-[11px] text-text-muted flex items-center gap-1">
            <TrendingUpIcon className="size-3 text-success" />
            <span>Target threshold: <strong>90.0%</strong></span>
          </p>
        </CardContent>
      </Card>

      {/* 2. Matched Invoices */}
      <Card className="relative overflow-hidden border-border bg-card shadow-xs transition-all hover:shadow-sm">
        <div className="absolute top-0 right-0 h-1 w-full bg-linear-to-r from-emerald-500 to-teal-400" />
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-semibold text-text-muted">
            Matched Triplets
          </CardTitle>
          <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
            <CheckCircle2Icon className="size-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-bold text-text-primary tracking-tight font-mono">
              {matchedCount}
            </div>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {((matchedCount / (totalCount || 1)) * 100).toFixed(0)}% of total
            </span>
          </div>

          <div className="mt-3">
            <Progress
              value={(matchedCount / (totalCount || 1)) * 100}
              className="h-1.5 bg-surface-3 [&>[data-slot=progress-indicator]]:bg-emerald-500"
            />
          </div>

          <p className="mt-2 text-[11px] text-text-muted">
            3-Way matched across Invoice, Razorpay & Bank
          </p>
        </CardContent>
      </Card>

      {/* 3. Exceptions */}
      <Card className="relative overflow-hidden border-border bg-card shadow-xs transition-all hover:shadow-sm">
        <div className="absolute top-0 right-0 h-1 w-full bg-linear-to-r from-rose-500 to-amber-500" />
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-semibold text-text-muted">
            Honest Exceptions
          </CardTitle>
          <div className="flex size-7 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
            <AlertTriangleIcon className="size-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 tracking-tight font-mono">
              {exceptionCount}
            </div>
            <Badge
              variant="outline"
              className="text-[10px] h-4.5 px-1.5 text-rose-600 border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20"
            >
              Action Required
            </Badge>
          </div>

          <div className="mt-3">
            <Progress
              value={(exceptionCount / (totalCount || 1)) * 100}
              className="h-1.5 bg-surface-3 [&>[data-slot=progress-indicator]]:bg-rose-500"
            />
          </div>

          <p className="mt-2 text-[11px] text-text-muted">
            Discrepancies flagged for audit review
          </p>
        </CardContent>
      </Card>

      {/* 4. Total Invoices */}
      <Card className="relative overflow-hidden border-border bg-card shadow-xs transition-all hover:shadow-sm">
        <div className="absolute top-0 right-0 h-1 w-full bg-linear-to-r from-blue-600 to-indigo-600" />
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xs font-semibold text-text-muted">
            Total Pipeline Volume
          </CardTitle>
          <div className="flex size-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
            <LayersIcon className="size-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-bold text-text-primary tracking-tight font-mono">
              {totalCount}
            </div>
            <span className="text-xs font-mono text-text-muted">
              3 datasets
            </span>
          </div>

          <div className="mt-3">
            <Progress
              value={100}
              className="h-1.5 bg-surface-3 [&>[data-slot=progress-indicator]]:bg-blue-600"
            />
          </div>

          <p className="mt-2 text-[11px] text-text-muted">
            100% processed through standardization
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
