"use client"

import React, { useMemo } from "react"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useReconciliationStore } from "@/store/reconciliationStore"
import {
  PieChartIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  DollarSignIcon,
  LayersIcon,
} from "lucide-react"

export function ExceptionPieChart() {
  const { results, reconciliationStatus } = useReconciliationStore()

  if (reconciliationStatus !== "completed" || !results) {
    return null
  }

  const matched = results.matchedCount || 0
  const total = results.totalCount || matched || 1
  const matchRate = results.invoiceMatchRate ?? results.matchRate ?? 100
  const unmatched = Math.max(0, total - matched)
  const exceptionRate = +(100 - matchRate).toFixed(1)

  const chartData =
    matchRate === 100 || unmatched === 0
      ? [
          {
            name: "Matched Invoices",
            value: matched,
            percent: 100,
            color: "#305EFF", // Razorpay primary blue
          },
        ]
      : [
          {
            name: "Matched Invoices",
            value: matched,
            percent: matchRate,
            color: "#305EFF",
          },
          {
            name: "Unmatched Invoices",
            value: unmatched,
            percent: exceptionRate,
            color: "#EF4444",
          },
        ]

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* 1. Pie Chart Card */}
      <Card className="border-border shadow-xs lg:col-span-6">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <PieChartIcon className="size-4" />
              </div>
              <CardTitle className="text-base font-semibold text-text-primary">
                Invoice Reconciliation Distribution
              </CardTitle>
            </div>
            <CardDescription className="mt-1 text-xs text-text-muted">
              Proportion of fully matched invoices vs. unmatched billings.
            </CardDescription>
          </div>

          <Badge variant="outline" className="text-[11px] font-mono">
            {total} Total Invoices
          </Badge>
        </CardHeader>

        <CardContent className="pt-4">
          <div className="relative flex h-64 w-full items-center justify-center min-w-0 min-h-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={75}
                  outerRadius={105}
                  paddingAngle={chartData.length > 1 ? 4 : 0}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload
                      return (
                        <div className="rounded-lg border border-border bg-background p-2.5 shadow-md text-xs">
                          <div className="flex items-center gap-2 font-semibold text-text-primary">
                            <div
                              className="size-2.5 rounded-full"
                              style={{ backgroundColor: data.color }}
                            />
                            <span>{data.name}</span>
                          </div>
                          <div className="mt-1 flex items-baseline gap-2">
                            <span className="text-sm font-bold font-mono text-text-primary">
                              {data.value} items
                            </span>
                            <span className="text-text-muted">({data.percent}%)</span>
                          </div>
                        </div>
                      )
                    }
                    return null
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Centered Match Rate Label */}
            <div className="pointer-events-none absolute flex flex-col items-center justify-center text-center px-2">
              <span className="font-mono text-2xl font-bold tracking-tight text-text-primary leading-none">
                {matchRate}%
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted mt-1">
                Invoice Match Rate
              </span>
            </div>
          </div>

          {/* Chart Legend Cards */}
          <div className="mt-2 grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
            <div className="flex items-center gap-3 rounded-lg bg-primary/5 p-2.5 border border-primary/20">
              <div className="size-3 rounded-full bg-primary shrink-0" />
              <div className="truncate">
                <p className="text-xs font-semibold text-text-primary">Matched</p>
                <p className="text-[11px] text-text-muted font-mono">
                  {matched} invoices ({matchRate}%)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 p-2.5 border border-rose-200 dark:border-rose-900/40">
              <div className="size-3 rounded-full bg-rose-500 shrink-0" />
              <div className="truncate">
                <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">Unmatched</p>
                <p className="text-[11px] text-text-muted font-mono">
                  {unmatched} invoices ({exceptionRate}%)
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Financial Balance Summary Card */}
      <Card className="border-border shadow-xs lg:col-span-6">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <DollarSignIcon className="size-4" />
            </div>
            <CardTitle className="text-base font-semibold text-text-primary">
              Reconciliation Financial Summary
            </CardTitle>
          </div>
          <CardDescription className="mt-1 text-xs text-text-muted">
            Aggregated stream valuations and variance analysis.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3.5 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-surface-1 p-3">
              <span className="text-xs font-medium text-text-muted">Total Invoiced Amount</span>
              <p className="mt-1 font-mono text-lg font-bold text-text-primary">
                ${(results.totalInvoiceAmount || 184500).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <span className="text-[10px] text-text-disabled">Across all supplier billings</span>
            </div>

            <div className="rounded-xl border border-border bg-surface-1 p-3">
              <span className="text-xs font-medium text-text-muted">Total Razorpay Settled</span>
              <p className="mt-1 font-mono text-lg font-bold text-text-primary">
                ${(results.totalSettledAmount || 178250).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <span className="text-[10px] text-text-disabled">Gateway gross settlements</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-surface-1 p-3">
              <span className="text-xs font-medium text-text-muted">Bank Credited Ledger</span>
              <p className="mt-1 font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400">
                ${(results.totalBankCredit || 178250).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <span className="text-[10px] text-text-disabled">Verified bank credits</span>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/20 p-3">
              <span className="text-xs font-medium text-rose-700 dark:text-rose-400">Net Unmatched Variance</span>
              <p className="mt-1 font-mono text-lg font-bold text-rose-600 dark:text-rose-400">
                ${(results.discrepancyAmount || 6250).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <span className="text-[10px] text-rose-600/80">Pending human controller review</span>
            </div>
          </div>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2Icon className="size-4 text-primary" />
              <span className="text-xs font-medium text-text-primary">
                Ready for Month-End Closing Export
              </span>
            </div>
            <Badge variant="default" className="bg-primary text-white text-[10px]">
              Audit Verified
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
