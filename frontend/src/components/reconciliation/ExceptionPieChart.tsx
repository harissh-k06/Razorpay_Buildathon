"use client"

import React from "react"
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { PieChartIcon } from "lucide-react"

export interface ExceptionPieChartProps {
  matchedCount?: number
  unallocatedCount?: number
  exceptionsCount?: number
  resolvedCount?: number
  totalAuditUniverse?: number
  recordCoverageRate?: number
  totalTriplets?: number
  totalExceptions?: number
}

export function ExceptionPieChart(props: ExceptionPieChartProps = {}) {
  const store = useReconciliationStore()
  const results = store.results

  // Resolve counts from props first, then fallback to store results
  const storeExceptions = results?.exceptions || []
  const storeResolvedCount = storeExceptions.filter((e) => e.status_type === "resolved" || e.status === "Resolved").length
  const storeUnallocatedCount = storeExceptions.filter((e) => e.status_type === "unallocated_cash" && e.status !== "Resolved").length
  const storeExceptionsCount = storeExceptions.filter((e) => e.status_type === "exception" && e.status !== "Resolved").length
  const storeMatchedCount = results?.matchedCount || results?.triplets?.length || 0

  const matchedCount = props.matchedCount !== undefined ? props.matchedCount : storeMatchedCount
  const unallocatedCount = props.unallocatedCount !== undefined ? props.unallocatedCount : storeUnallocatedCount
  const exceptionsCount = props.exceptionsCount !== undefined ? props.exceptionsCount : storeExceptionsCount
  const resolvedCount = props.resolvedCount !== undefined ? props.resolvedCount : storeResolvedCount

  const totalTriplets = props.totalTriplets !== undefined ? props.totalTriplets : (results?.triplets?.length || matchedCount)
  const totalExceptions = props.totalExceptions !== undefined ? props.totalExceptions : (storeExceptions.length || (unallocatedCount + exceptionsCount + resolvedCount))

  const totalAuditUniverse = props.totalAuditUniverse !== undefined
    ? props.totalAuditUniverse
    : Math.max(matchedCount + unallocatedCount + exceptionsCount + resolvedCount, 1)

  const safeTotal = totalAuditUniverse > 0 ? totalAuditUniverse : 1
  const recordCoverageRate = props.recordCoverageRate !== undefined
    ? props.recordCoverageRate
    : (results?.recordCoverageRate ?? (totalTriplets + totalExceptions > 0 ? +((totalTriplets / (totalTriplets + totalExceptions)) * 100).toFixed(1) : 100))

  const matchedPercent = +((matchedCount / safeTotal) * 100).toFixed(1)
  const unallocatedPercent = +((unallocatedCount / safeTotal) * 100).toFixed(1)
  const exceptionsPercent = +((exceptionsCount / safeTotal) * 100).toFixed(1)
  const resolvedPercent = +((resolvedCount / safeTotal) * 100).toFixed(1)

  // 4-slice Pie Chart Data: Blue (Matched), Amber (Unallocated Cash), Red (Missing Cash Exceptions), Green (Resolved)
  const pieData = [
    {
      name: "Matched Triplets",
      value: matchedCount,
      percent: matchedPercent,
      color: "#0D94FB", // Blue
    },
    ...(unallocatedCount > 0
      ? [
          {
            name: "Unallocated Cash",
            value: unallocatedCount,
            percent: unallocatedPercent,
            color: "#F59E0B", // Dark Yellow / Amber
          },
        ]
      : []),
    ...(exceptionsCount > 0
      ? [
          {
            name: "Exceptions (Missing Cash)",
            value: exceptionsCount,
            percent: exceptionsPercent,
            color: "#EF4444", // Red / Coral
          },
        ]
      : []),
    ...(resolvedCount > 0
      ? [
          {
            name: "Resolved",
            value: resolvedCount,
            percent: resolvedPercent,
            color: "#10B981", // Emerald Green
          },
        ]
      : []),
  ]

  return (
    <Card className="border border-border/80 bg-card shadow-xs overflow-hidden flex flex-col justify-between">
      <CardHeader className="bg-surface-1/60 border-b border-border/50 text-center py-2.5 px-4">
        <div className="flex items-center justify-center gap-1.5">
          <div className="flex size-5 items-center justify-center rounded bg-[#0D94FB]/10 text-[#0D94FB]">
            <PieChartIcon className="size-3.5" />
          </div>
          <CardTitle className="text-sm font-bold text-text-primary">
            Reconciliation Status Distribution
          </CardTitle>
        </div>
        <CardDescription className="text-[11px] text-text-muted mt-0.5">
          Distribution across Matched Triplets (Blue), Unallocated Cash (Amber), Exceptions (Red), and Resolved (Green).
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-4 pb-3.5 px-4 bg-card text-foreground flex-1 flex flex-col justify-between">
        <div className="flex flex-col items-center justify-center">
          {/* Donut Chart with Center Coverage Percentage */}
          <div className="relative flex h-56 w-full max-w-sm items-center justify-center min-w-0 min-h-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={72}
                  outerRadius={98}
                  paddingAngle={pieData.length > 1 ? 4 : 0}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload
                      return (
                        <div className="rounded-lg border border-border bg-background p-2.5 shadow-md text-xs">
                          <div className="flex items-center gap-1.5 font-semibold text-text-primary">
                            <div className="size-2 rounded-full" style={{ backgroundColor: data.color }} />
                            <span>{data.name}</span>
                          </div>
                          <div className="mt-1 flex items-baseline gap-1.5">
                            <span className="font-bold text-text-primary font-mono text-xs">{data.value} records</span>
                            <span className="text-text-muted font-medium text-[11px]">
                              ({data.percent || ((data.value / safeTotal) * 100).toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      )
                    }
                    return null
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Center Record Coverage Label */}
            <div className="pointer-events-none absolute flex flex-col items-center justify-center text-center px-2">
              <span className="font-mono text-2xl font-bold tracking-tight text-[#0D94FB] leading-none">
                {recordCoverageRate}%
              </span>
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mt-1">
                Record Coverage
              </span>
            </div>
          </div>

          {/* Centered Caption / Legend & Metrics */}
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2.5 text-xs border-t border-border/40 pt-2.5 w-full max-w-2xl min-h-[64px]">
            {/* 1. Matched Invoices (Blue) */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0D94FB]/10 border border-[#0D94FB]/25 text-[11px]">
              <div className="size-2 rounded-full bg-[#0D94FB] shrink-0" />
              <span className="font-semibold text-text-primary">Matched:</span>
              <span className="font-mono font-bold text-[#0D94FB]">{matchedCount}</span>
              <span className="text-text-muted font-medium font-mono">({matchedPercent}%)</span>
            </div>

            {/* 2. Unallocated Cash (Amber) */}
            {unallocatedCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px]">
                <div className="size-2 rounded-full bg-amber-500 shrink-0" />
                <span className="font-semibold text-amber-700 dark:text-amber-400">Unallocated:</span>
                <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{unallocatedCount}</span>
                <span className="text-text-muted font-medium font-mono">({unallocatedPercent}%)</span>
              </div>
            )}

            {/* 3. Exceptions (Red) */}
            {exceptionsCount > 0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[11px]">
                <div className="size-2 rounded-full bg-rose-500 shrink-0" />
                <span className="font-semibold text-rose-700 dark:text-rose-400">Exceptions:</span>
                <span className="font-mono font-bold text-rose-600 dark:text-rose-400">{exceptionsCount}</span>
                <span className="text-text-muted font-medium font-mono">({exceptionsPercent}%)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-border/60 text-[11px]">
                <span className="font-semibold text-text-primary">Zero Exceptions</span>
              </div>
            )}

            {/* 4. Resolved (Green) */}
            {resolvedCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[11px]">
                <div className="size-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">Resolved:</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{resolvedCount}</span>
                <span className="text-text-muted font-medium font-mono">({resolvedPercent}%)</span>
              </div>
            )}

            {/* Record Coverage */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-border/60 text-[11px]">
              <span className="font-semibold text-text-primary">Coverage:</span>
              <span className="font-mono font-bold text-text-primary">{recordCoverageRate}%</span>
              <span className="text-text-muted font-mono text-[10px]">
                ({totalTriplets}/{totalTriplets + totalExceptions})
              </span>
            </div>
          </div>
        </div>

        {/* Detailed Metric Definition */}
        <p className="mt-2 text-[11px] text-text-muted italic text-center leading-relaxed">
          <span className="font-semibold text-text-primary not-italic">Record Coverage Rate ({recordCoverageRate}%):</span> Total 3-way audit universe — <span className="font-semibold text-[#0D94FB] not-italic">{totalTriplets}</span> verified triplets out of <span className="font-semibold text-text-primary not-italic">{totalTriplets + totalExceptions}</span> total reconciliation items (accounting for unallocated cash & exceptions).
        </p>
      </CardContent>
    </Card>
  )
}
