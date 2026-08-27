"use client"

import React, { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { MatchedTriplet, ReconciliationException } from "@/lib/reconciliation-types"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts"
import {
  CheckCircle2Icon, AlertTriangleIcon, TrendingUpIcon,
  RotateCcwIcon, SearchIcon, DownloadIcon, ChevronDownIcon, ChevronRightIcon,
  LayersIcon, ShieldCheckIcon, HelpCircleIcon, PieChartIcon,
  BanknoteIcon, DollarSignIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ── Financial Metric Card with Clean Light Background and Blue Accent Text ───
function SummaryCard({
  title, value, sub, icon, variant = "default",
}: {
  title: string; value: string | number; sub?: string
  icon: React.ReactNode; variant?: "default" | "success" | "warning" | "destructive"
}) {
  const iconColors = {
    default:     "bg-[#0D94FB]/10 text-[#0D94FB]",
    success:     "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    warning:     "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    destructive: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  }
  return (
    <Card className="border border-border/80 bg-card shadow-xs hover:border-[#0D94FB]/40 transition-colors">
      <CardContent className="p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-2.5">
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{title}</p>
            <p className="text-xl font-bold font-mono tracking-tight text-[#0D94FB]">{value}</p>
            {sub && <p className="text-[11px] text-text-muted leading-tight">{sub}</p>}
          </div>
          <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconColors[variant])}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Grouping Types & Helper ──────────────────────────────────────────────────
interface ChildItem {
  id: string
  invoice_id: string
  razorpay_id: string
  bank_ref_no: string
  vendor: string
  amount: number
  date: string
  match_type: string
}

interface GroupRow {
  kind: "group"
  id: string
  groupType: "N:1" | "1:N"
  key: string
  title: string
  subtitle: string
  vendor: string
  totalAmount: number
  date: string
  items: ChildItem[]
}

interface SingleRow {
  kind: "single"
  id: string
  triplet: MatchedTriplet
}

type DisplayRow = SingleRow | GroupRow

function groupTriplets(triplets: MatchedTriplet[]): DisplayRow[] {
  const result: DisplayRow[] = []
  const processedTripletIds = new Set<string>()

  // 1. Identify 1:N splits (same invoice_id appears in multiple triplets)
  const invoiceMap = new Map<string, MatchedTriplet[]>()
  for (const t of triplets) {
    if (t.invoice_id && !t.invoice_id.includes(",")) {
      const list = invoiceMap.get(t.invoice_id) || []
      list.push(t)
      invoiceMap.set(t.invoice_id, list)
    }
  }

  for (const [invId, groupTrips] of invoiceMap.entries()) {
    if (groupTrips.length > 1) {
      const totalAmt = groupTrips.reduce((sum, t) => sum + (t.amount || 0), 0)
      const first = groupTrips[0]
      result.push({
        kind: "group",
        id: `GROUP-1N-${invId}`,
        groupType: "1:N",
        key: invId,
        title: `Invoice: ${invId}`,
        subtitle: `1 Invoice split across ${groupTrips.length} Settlements`,
        vendor: first.vendor || "—",
        totalAmount: totalAmt,
        date: first.date || "—",
        items: groupTrips.map((t, idx) => ({
          id: t.id || `split-${idx}`,
          invoice_id: t.invoice_id,
          razorpay_id: t.razorpay_id,
          bank_ref_no: t.bank_ref_no,
          vendor: t.vendor || "—",
          amount: t.amount,
          date: t.date || "—",
          match_type: "1:N Split",
        })),
      })
      groupTrips.forEach((t) => processedTripletIds.add(t.id))
    }
  }

  // 2. Identify N:1 groups (multiple invoices in a single triplet OR sharing same settlement_utr / razorpay_id)
  const remainingTriplets = triplets.filter((t) => !processedTripletIds.has(t.id))
  const settlementMap = new Map<string, MatchedTriplet[]>()

  for (const t of remainingTriplets) {
    const key = t.settlement_utr || t.razorpay_id || t.id
    const list = settlementMap.get(key) || []
    list.push(t)
    settlementMap.set(key, list)
  }

  for (const [settKey, groupTrips] of settlementMap.entries()) {
    const isMultiInvoiceSingleTrip =
      groupTrips.length === 1 &&
      ((groupTrips[0].invoice_ids && groupTrips[0].invoice_ids.length > 1) ||
        (groupTrips[0].invoice_id && groupTrips[0].invoice_id.includes(",")) ||
        groupTrips[0].match_type === "N:1 Group")

    if (groupTrips.length > 1) {
      const totalAmt = groupTrips.reduce((sum, t) => sum + (t.amount || 0), 0)
      const first = groupTrips[0]
      result.push({
        kind: "group",
        id: `GROUP-N1-${settKey}`,
        groupType: "N:1",
        key: settKey,
        title: `Settlement: ${first.razorpay_id || settKey}`,
        subtitle: `${groupTrips.length} Invoices batched in 1 Deposit`,
        vendor: first.vendor || "—",
        totalAmount: totalAmt,
        date: first.date || "—",
        items: groupTrips.map((t, idx) => ({
          id: t.id || `batch-${idx}`,
          invoice_id: t.invoice_id,
          razorpay_id: t.razorpay_id,
          bank_ref_no: t.bank_ref_no,
          vendor: t.vendor || "—",
          amount: t.amount,
          date: t.date || "—",
          match_type: "N:1 Group",
        })),
      })
      groupTrips.forEach((t) => processedTripletIds.add(t.id))
    } else if (isMultiInvoiceSingleTrip) {
      const t = groupTrips[0]
      const invList =
        t.invoice_ids && t.invoice_ids.length > 0
          ? t.invoice_ids
          : t.invoice_id.split(",").map((s) => s.trim())
      const subAmount = t.amount / (invList.length || 1)

      result.push({
        kind: "group",
        id: `GROUP-N1-MULTI-${t.id}`,
        groupType: "N:1",
        key: t.razorpay_id || t.id,
        title: `Settlement: ${t.razorpay_id || t.id}`,
        subtitle: `${invList.length} Invoices covered in 1 Deposit`,
        vendor: t.vendor || "—",
        totalAmount: t.amount,
        date: t.date || "—",
        items: invList.map((inv, idx) => ({
          id: `${t.id}-inv-${idx}`,
          invoice_id: inv,
          razorpay_id: t.razorpay_id,
          bank_ref_no: t.bank_ref_no,
          vendor: t.vendor || "—",
          amount: subAmount,
          date: t.date || "—",
          match_type: "N:1 Group",
        })),
      })
      processedTripletIds.add(t.id)
    }
  }

  // 3. Add remaining standard 1:1 triplets
  for (const t of triplets) {
    if (!processedTripletIds.has(t.id)) {
      result.push({
        kind: "single",
        id: t.id,
        triplet: t,
      })
    }
  }

  return result
}

// ── Main Results Page Component ───────────────────────────────────────────────
export default function ResultsPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const { results, resetAll } = useReconciliationStore()
  const [activeTab, setActiveTab] = useState<string>("matched")
  const [search, setSearch] = useState("")
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    setMounted(true)
  }, [])

  // Process grouped rows
  const groupedRows = useMemo(() => groupTriplets(results?.triplets || []), [results?.triplets])

  // Split exceptions into Unallocated Cash (Medium Risk / Extra Cash) vs True Audit Exceptions (High Risk / Missing Cash)
  const unallocatedCashList = useMemo(() => {
    return (results?.exceptions || []).filter((e) => {
      const type = e.type.toLowerCase()
      const reason = (e.reason || "").toLowerCase()
      // Razorpay with "No matching invoice" (Extra cash sitting at gateway)
      if (type === "razorpay" && (reason.includes("no matching invoice") || reason.includes("without invoice") || reason.includes("unallocated"))) {
        return true
      }
      // Bank with "No matching invoice" or "No matching Razorpay settlement or invoice" (Extra cash sitting in bank)
      if (type === "bank" && (reason.includes("no matching invoice") || reason.includes("unallocated") || reason.includes("settlement or invoice"))) {
        return true
      }
      return false
    })
  }, [results?.exceptions])

  const auditExceptionsList = useMemo(() => {
    return (results?.exceptions || []).filter((e) => {
      const type = e.type.toLowerCase()
      const reason = (e.reason || "").toLowerCase()
      // Invoices with "No matching Razorpay settlement" (Billed, but gateway didn't capture)
      if (type === "invoice" && (reason.includes("no matching razorpay") || reason.includes("settlement") || reason.includes("unmatched"))) {
        return true
      }
      // Razorpay with "No matching Bank deposit" (Gateway settled, but bank didn't receive)
      if (type === "razorpay" && (reason.includes("no matching bank") || reason.includes("bank deposit"))) {
        return true
      }
      // Bank with "No matching Razorpay settlement" (Bank deposit exists, but no gateway matching it)
      if (type === "bank" && reason.includes("no matching razorpay settlement") && !reason.includes("invoice")) {
        return true
      }
      // Default fallback
      if (type === "invoice") return true
      if (type === "razorpay" && !reason.includes("no matching invoice")) return true
      if (type === "bank" && !reason.includes("no matching invoice")) return true
      return false
    })
  }, [results?.exceptions])

  // Filtered rows for Tab 1 (Matched Triplets)
  const filteredDisplayRows = useMemo(() => {
    if (!search.trim()) return groupedRows
    const q = search.toLowerCase()
    return groupedRows.filter((row) => {
      if (row.kind === "single") {
        const t = row.triplet
        return (
          t.invoice_id.toLowerCase().includes(q) ||
          t.razorpay_id.toLowerCase().includes(q) ||
          t.bank_ref_no.toLowerCase().includes(q) ||
          (t.vendor ?? "").toLowerCase().includes(q)
        )
      } else {
        const matchesParent =
          row.title.toLowerCase().includes(q) ||
          row.subtitle.toLowerCase().includes(q) ||
          row.vendor.toLowerCase().includes(q)
        const matchesChild = row.items.some(
          (item) =>
            item.invoice_id.toLowerCase().includes(q) ||
            item.razorpay_id.toLowerCase().includes(q) ||
            item.bank_ref_no.toLowerCase().includes(q) ||
            item.vendor.toLowerCase().includes(q)
        )
        return matchesParent || matchesChild
      }
    })
  }, [groupedRows, search])

  // Filtered rows for Tab 2 (Unallocated Cash)
  const filteredUnallocatedCash = useMemo(() => {
    if (!search.trim()) return unallocatedCashList
    const q = search.toLowerCase()
    return unallocatedCashList.filter(
      (e) =>
        e.source_id.toLowerCase().includes(q) ||
        (e.vendor ?? "").toLowerCase().includes(q) ||
        (e.reason ?? "").toLowerCase().includes(q)
    )
  }, [unallocatedCashList, search])

  // Filtered rows for Tab 3 (Audit Exceptions)
  const filteredAuditExceptions = useMemo(() => {
    if (!search.trim()) return auditExceptionsList
    const q = search.toLowerCase()
    return auditExceptionsList.filter(
      (e) =>
        e.source_id.toLowerCase().includes(q) ||
        (e.vendor ?? "").toLowerCase().includes(q) ||
        (e.reason ?? "").toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q)
    )
  }, [auditExceptionsList, search])

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const expandAllGroups = () => {
    const allGroupIds = groupedRows
      .filter((r): r is GroupRow => r.kind === "group")
      .map((r) => r.id)
    setExpandedGroups(new Set(allGroupIds))
  }

  const collapseAllGroups = () => {
    setExpandedGroups(new Set())
  }

  const handleReset = () => {
    resetAll()
    router.push("/reconciliation/upload")
  }

  const exportCSV = (rows: any[], filename: string) => {
    if (!rows || !rows.length) return
    const headers = Object.keys(rows[0]).join(",")
    const body = rows
      .map((r) =>
        Object.values(r)
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n")
    const blob = new Blob([headers + "\n" + body], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const fmt = (n?: number) =>
    n !== undefined
      ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "—"

  // If no results, show placeholder
  if (!mounted || !results) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center p-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-[#0D94FB]/10 text-[#0D94FB] mb-3">
          <PieChartIcon className="size-6" />
        </div>
        <h2 className="text-base font-bold text-text-primary mb-1">No Reconciliation Results</h2>
        <p className="text-xs text-text-muted max-w-sm mb-4">
          Upload and review your transaction files to generate reconciliation results.
        </p>
        <Button size="sm" onClick={() => router.push("/reconciliation/upload")} className="bg-[#0D94FB] text-white text-xs h-8">
          Go to Upload
        </Button>
      </div>
    )
  }

  // Strictly Invoice Match Rate
  const matchedCount = results.matchedCount || 0
  const totalCount = results.totalCount || matchedCount || 1
  const matchRate = results.invoiceMatchRate ?? results.matchRate ?? 100
  const unmatchedCount = Math.max(0, totalCount - matchedCount)
  const exceptionRate = +(100 - matchRate).toFixed(1)

  // Record Coverage Rate (Matched Triplets / (Matched Triplets + Total Exceptions))
  const totalTriplets = results.triplets?.length || matchedCount
  const totalExceptions = results.exceptions?.length || 0
  const recordCoverageRate =
    results.recordCoverageRate ??
    (totalTriplets + totalExceptions > 0
      ? +((totalTriplets / (totalTriplets + totalExceptions)) * 100).toFixed(1)
      : 100)

  // 3-Way Reconciliation Universe: Matched Invoices + Unallocated Cash + Missing Cash Exceptions
  const unallocatedCount = unallocatedCashList.length
  const auditExceptionsCount = auditExceptionsList.length
  const totalAuditUniverse = matchedCount + unallocatedCount + auditExceptionsCount || 1

  const matchedPercent = +((matchedCount / totalAuditUniverse) * 100).toFixed(1)
  const unallocatedPercent = +((unallocatedCount / totalAuditUniverse) * 100).toFixed(1)
  const exceptionsPercent = +((auditExceptionsCount / totalAuditUniverse) * 100).toFixed(1)

  // 3-slice Pie Chart Data: Blue (Matched), Dark Yellow/Amber (Unallocated Cash), Red (Missing Cash Exceptions)
  const pieData = [
    {
      name: "Matched Invoices",
      value: matchedCount,
      percent: matchedPercent,
      color: "#0D94FB", // Blue
    },
    ...(unallocatedCount > 0
      ? [
          {
            name: "Unallocated Cash (Extra)",
            value: unallocatedCount,
            percent: unallocatedPercent,
            color: "#F59E0B", // Dark Yellow / Amber
          },
        ]
      : []),
    ...(auditExceptionsCount > 0
      ? [
          {
            name: "Exceptions (Missing Cash)",
            value: auditExceptionsCount,
            percent: exceptionsPercent,
            color: "#EF4444", // Red
          },
        ]
      : []),
  ]

  const n1Count = groupedRows.filter((r) => r.kind === "group" && r.groupType === "N:1").length
  const oneNCount = groupedRows.filter((r) => r.kind === "group" && r.groupType === "1:N").length

  return (
    <div className="p-4 sm:p-5 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text-primary">
            Reconciliation Results &amp; Audit Log
          </h1>
          <p className="mt-0.5 text-xs text-text-muted">
            3-way matching finalized across Invoices, Razorpay settlements, and Bank deposits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReset} className="h-7.5 text-xs font-medium px-2.5">
            <RotateCcwIcon className="mr-1.5 size-3" /> Start New Reconciliation
          </Button>
        </div>
      </div>

      {/* 1. Top Section: Three Summary Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          title="Total Invoiced Amount"
          value={fmt(results.totalInvoiceAmount)}
          sub="Gross accounts receivable billing volume"
          icon={<TrendingUpIcon className="size-4" />}
        />
        <SummaryCard
          title="Total Settled &amp; Credited"
          value={fmt(results.totalSettledAmount)}
          sub="Gateway verified bank ledger deposits"
          icon={<CheckCircle2Icon className="size-4" />}
          variant="success"
        />
        <SummaryCard
          title="Discrepancy Variance"
          value={fmt(results.discrepancyAmount)}
          sub={results.discrepancyAmount && results.discrepancyAmount > 0 ? "Pending audit resolution" : "Zero invoice discrepancy"}
          icon={<AlertTriangleIcon className="size-4" />}
          variant={results.discrepancyAmount && results.discrepancyAmount > 0 ? "warning" : "success"}
        />
      </div>

      {/* 2. Below: Centered Pie Chart Card */}
      <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
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
            Breakdown of Matched Triplets (Blue), Unallocated Cash (Amber), and Missing Cash Exceptions (Red).
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-4 pb-3.5 px-4 bg-card text-foreground">
          <div className="flex flex-col items-center justify-center">
            {/* Donut Chart with Center Percentage (Enlarged with ample inner clearance) */}
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
                                ({data.percent || ((data.value / totalAuditUniverse) * 100).toFixed(1)}%)
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

              {/* Center Match Rate Label with comfortable clearance */}
              <div className="pointer-events-none absolute flex flex-col items-center justify-center text-center px-2">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#0D94FB] leading-none">
                  {matchRate}%
                </span>
                <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mt-1">
                  Invoice Match Rate
                </span>
              </div>
            </div>

            {/* Centered Caption / Legend & Dual Metrics */}
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2.5 text-xs border-t border-border/40 pt-2.5 w-full max-w-xl">
              {/* 1. Matched Invoices (Blue) */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0D94FB]/10 border border-[#0D94FB]/25 text-[11px]">
                <div className="size-2 rounded-full bg-[#0D94FB] shrink-0" />
                <span className="font-semibold text-text-primary">Matched:</span>
                <span className="font-mono font-bold text-[#0D94FB]">{matchedCount}</span>
                <span className="text-text-muted font-medium font-mono">({matchedPercent}%)</span>
              </div>

              {/* 2. Unallocated Cash (Amber / Dark Yellow) */}
              {unallocatedCount > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px]">
                  <div className="size-2 rounded-full bg-amber-500 shrink-0" />
                  <span className="font-semibold text-amber-700 dark:text-amber-400">Unallocated Cash:</span>
                  <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{unallocatedCount}</span>
                  <span className="text-text-muted font-medium font-mono">({unallocatedPercent}%)</span>
                </div>
              )}

              {/* 3. Exceptions (Red) */}
              {auditExceptionsCount > 0 ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[11px]">
                  <div className="size-2 rounded-full bg-rose-500 shrink-0" />
                  <span className="font-semibold text-rose-700 dark:text-rose-400">Exceptions:</span>
                  <span className="font-mono font-bold text-rose-600 dark:text-rose-400">{auditExceptionsCount}</span>
                  <span className="text-text-muted font-medium font-mono">({exceptionsPercent}%)</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0D94FB]/10 border border-[#0D94FB]/25 text-[11px]">
                  <CheckCircle2Icon className="size-3 text-[#0D94FB] shrink-0" />
                  <span className="font-semibold text-text-primary">Zero Exceptions</span>
                  <span className="font-mono font-bold text-[#0D94FB]">(0%)</span>
                </div>
              )}

              {/* Record Coverage */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-border/60 text-[11px]">
                <span className="font-semibold text-text-primary">Coverage:</span>
                <span className="font-mono font-bold text-text-primary">{recordCoverageRate}%</span>
                <span className="text-text-muted font-mono text-[10px]">({totalTriplets}/{totalTriplets + totalExceptions})</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Below: 3 Distinct Tabs (Matched Triplets | Unallocated Cash | Exceptions) */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-border/60 pb-2">
          <TabsList className="bg-surface-2 p-0.5 rounded-lg flex flex-wrap h-auto">
            {/* Tab 1: Matched Triplets */}
            <TabsTrigger
              value="matched"
              className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-background data-[state=active]:text-[#0D94FB] data-[state=active]:shadow-xs transition-all"
            >
              <CheckCircle2Icon className="mr-1.5 size-3.5 text-[#0D94FB]" />
              Matched Triplets
              <Badge
                variant="secondary"
                className="ml-1.5 text-[10px] px-1.5 py-0 font-mono font-bold bg-[#0D94FB]/10 text-[#0D94FB] border border-[#0D94FB]/20"
              >
                {results.triplets?.length || 0}
              </Badge>
            </TabsTrigger>

            {/* Tab 2: Unallocated Cash (Razorpay cash entries with no invoice) */}
            <TabsTrigger
              value="unallocated"
              className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-background data-[state=active]:text-amber-600 dark:data-[state=active]:text-amber-400 data-[state=active]:shadow-xs transition-all"
            >
              <BanknoteIcon className="mr-1.5 size-3.5 text-amber-500" />
              Unallocated Cash
              <Badge
                variant="secondary"
                className="ml-1.5 text-[10px] px-1.5 py-0 font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
              >
                {unallocatedCashList.length}
              </Badge>
            </TabsTrigger>

            {/* Tab 3: Exceptions (Unmatched Invoices & Bank records) */}
            <TabsTrigger
              value="exceptions"
              className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-background data-[state=active]:text-destructive data-[state=active]:shadow-xs transition-all"
            >
              <AlertTriangleIcon className="mr-1.5 size-3.5 text-destructive" />
              Exceptions
              <Badge
                variant="secondary"
                className={`ml-1.5 text-[10px] px-1.5 py-0 font-mono font-bold ${
                  auditExceptionsList.length > 0
                    ? "bg-destructive/10 text-destructive border border-destructive/20"
                    : "bg-muted text-text-muted border border-border"
                }`}
              >
                {auditExceptionsList.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <div className="relative w-44 sm:w-56">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-disabled pointer-events-none" />
              <Input
                placeholder={
                  activeTab === "matched"
                    ? "Search ID, UTR, Vendor..."
                    : activeTab === "unallocated"
                    ? "Search Settlements..."
                    : "Search Exceptions..."
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7.5 pl-8 text-xs bg-background"
              />
            </div>

            {activeTab === "matched" ? (
              <Button
                size="sm"
                onClick={() => exportCSV(results.triplets, "matched_triplets.csv")}
                className="h-7.5 text-xs font-semibold bg-[#0D94FB] hover:bg-[#0D94FB]/90 text-white shadow-2xs px-3"
              >
                <DownloadIcon className="mr-1.5 size-3.5" /> Export Matched CSV
              </Button>
            ) : activeTab === "unallocated" ? (
              <Button
                size="sm"
                onClick={() => exportCSV(unallocatedCashList, "unallocated_cash.csv")}
                className="h-7.5 text-xs font-semibold bg-amber-600 hover:bg-amber-600/90 text-white shadow-2xs px-3"
              >
                <DownloadIcon className="mr-1.5 size-3.5" /> Export Unallocated CSV
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => exportCSV(auditExceptionsList, "exceptions.csv")}
                className="h-7.5 text-xs font-semibold bg-[#FF0000] hover:bg-[#FF0000]/90 text-white shadow-2xs px-3"
              >
                <DownloadIcon className="mr-1.5 size-3.5" /> Export Exceptions CSV
              </Button>
            )}
          </div>
        </div>

        {/* ── TAB 1: Matched Triplets ────────────────────────────────────────── */}
        <TabsContent value="matched" className="space-y-3">
          <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
            <CardHeader className="bg-surface-1/60 border-b border-border/50 flex flex-row items-center justify-between py-2.5 px-4">
              <div>
                <CardTitle className="text-xs font-bold text-text-primary">
                  3-Way Matched Transactions
                </CardTitle>
                <CardDescription className="text-[11px] text-text-muted mt-0.5">
                  Click on any N:1 or 1:N group row to expand and inspect constituent items.
                </CardDescription>
              </div>

              {/* Grouping Quick Controls */}
              <div className="flex items-center gap-2">
                {(n1Count > 0 || oneNCount > 0) && (
                  <>
                    <Badge variant="outline" className="text-[9px] font-mono text-[#0D94FB] border-[#0D94FB]/30 bg-[#0D94FB]/10 px-1.5 py-0">
                      {n1Count} N:1 Groups &bull; {oneNCount} 1:N Splits
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={expandedGroups.size > 0 ? collapseAllGroups : expandAllGroups}
                      className="h-6 text-[11px] text-text-muted hover:text-text-primary px-2"
                    >
                      {expandedGroups.size > 0 ? "Collapse All Groups" : "Expand All Groups"}
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>

            <CardContent className="pt-0 px-0 bg-card">
              <div className="max-h-[420px] overflow-y-auto overflow-x-auto relative rounded-b-xl">
                <Table>
                  <TableHeader className="sticky top-0 bg-surface-1/95 backdrop-blur z-10 shadow-xs">
                    <TableRow className="border-b border-border/60">
                      <TableHead className="w-9 text-center text-[11px] font-semibold text-text-secondary py-2 px-2.5">#</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Invoice ID</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Razorpay Settlement ID</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Bank Ref No (UTR)</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Vendor</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-text-secondary py-2 px-3">Amount</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Date</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold text-text-secondary py-2 px-3">Match Grouping</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-text-secondary py-2 px-3">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDisplayRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-28 text-center text-xs text-text-muted">
                          No records match your search criteria.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDisplayRows.map((row, idx) => {
                        if (row.kind === "single") {
                          const t = row.triplet
                          return (
                            <TableRow key={t.id || idx} className="hover:bg-surface-1/60 transition-colors border-b border-border/40">
                              <TableCell className="text-center font-mono text-[10px] text-text-disabled py-1.5 px-2.5">
                                {idx + 1}
                              </TableCell>
                              <TableCell className="font-mono text-xs font-semibold text-[#0D94FB] dark:text-blue-300 px-3 py-1.5">
                                {t.invoice_id || "—"}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-text-secondary px-3 py-1.5">
                                <span className="rounded bg-surface-2 px-1.5 py-0.5 border border-border/50 text-[11px]">
                                  {t.razorpay_id || "—"}
                                </span>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-text-secondary px-3 py-1.5 text-[11px]">
                                {t.bank_ref_no || "—"}
                              </TableCell>
                              <TableCell className="text-xs px-3 py-1.5 max-w-[150px] truncate text-text-primary">
                                {t.vendor || "—"}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-bold text-text-primary px-3 py-1.5">
                                {fmt(t.amount)}
                              </TableCell>
                              <TableCell className="text-xs px-3 py-1.5 text-text-muted">
                                {t.date || "—"}
                              </TableCell>
                              <TableCell className="text-center px-3 py-1.5">
                                <Badge variant="outline" className="text-[9px] bg-[#0D94FB]/5 text-[#0D94FB] border-[#0D94FB]/30 font-mono px-1.5 py-0">
                                  {t.match_type || "1:1 Exact"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right px-3 py-1.5">
                                <Badge className="bg-emerald-600 text-white text-[9px] font-medium px-1.5 py-0">
                                  <ShieldCheckIcon className="mr-0.5 size-2.5" />
                                  Matched
                                </Badge>
                              </TableCell>
                            </TableRow>
                          )
                        } else {
                          // Collapsible Group Row
                          const isExpanded = expandedGroups.has(row.id)
                          const splitLabel =
                            row.groupType === "1:N"
                              ? `1:${row.items.length} Split`
                              : `${row.items.length}:1 Split`

                          return (
                            <React.Fragment key={row.id}>
                              {/* Parent Group Header Row */}
                              <TableRow
                                onClick={() => toggleGroup(row.id)}
                                className="cursor-pointer bg-[#0D94FB]/5 hover:bg-[#0D94FB]/10 transition-colors border-b border-[#0D94FB]/20 select-none font-medium"
                              >
                                <TableCell className="text-center py-1.5 px-2.5">
                                  <button
                                    type="button"
                                    className="flex size-4.5 items-center justify-center rounded hover:bg-[#0D94FB]/20 text-[#0D94FB] mx-auto"
                                  >
                                    {isExpanded ? (
                                      <ChevronDownIcon className="size-3.5" />
                                    ) : (
                                      <ChevronRightIcon className="size-3.5" />
                                    )}
                                  </button>
                                </TableCell>
                                <TableCell className="font-mono text-xs font-bold text-[#0D94FB] px-3 py-1.5" colSpan={3}>
                                  <div className="flex items-center gap-1.5">
                                    <LayersIcon className="size-3.5 text-[#0D94FB] shrink-0" />
                                    <span>{row.title}</span>
                                    <span className="text-[11px] text-text-muted font-normal">({row.subtitle})</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs px-3 py-1.5 text-text-primary font-medium">
                                  {row.vendor}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs font-bold text-[#0D94FB] px-3 py-1.5">
                                  {fmt(row.totalAmount)}
                                </TableCell>
                                <TableCell className="text-xs px-3 py-1.5 text-text-muted">
                                  {row.date}
                                </TableCell>
                                <TableCell className="text-center px-3 py-1.5">
                                  <Badge variant="outline" className="text-[9px] bg-[#0D94FB]/5 text-[#0D94FB] border-[#0D94FB]/30 font-mono px-1.5 py-0">
                                    {splitLabel}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right px-3 py-1.5">
                                  <Badge className="bg-emerald-600 text-white text-[9px] font-medium px-1.5 py-0">
                                    <ShieldCheckIcon className="mr-0.5 size-2.5" />
                                    Matched
                                  </Badge>
                                </TableCell>
                              </TableRow>

                              {/* Indented Child Rows when expanded */}
                              {isExpanded &&
                                row.items.map((item, itemIdx) => (
                                  <TableRow
                                    key={item.id || `${row.id}-child-${itemIdx}`}
                                    className="bg-muted/20 hover:bg-muted/40 transition-colors border-b border-border/30"
                                  >
                                    <TableCell className="text-center font-mono text-[9px] text-text-disabled py-1 px-2.5">
                                      ↳
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-text-primary pl-6 py-1">
                                      <span className="font-semibold text-[#0D94FB]">{item.invoice_id || "—"}</span>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-text-secondary px-3 py-1">
                                      <span className="rounded bg-surface-2 px-1 py-0.5 border border-border/40 text-[10px]">
                                        {item.razorpay_id || "—"}
                                      </span>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-text-secondary px-3 py-1 text-[10px]">
                                      {item.bank_ref_no || "—"}
                                    </TableCell>
                                    <TableCell className="text-xs px-3 py-1 text-text-muted truncate max-w-[130px]">
                                      {item.vendor || "—"}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs font-semibold text-text-primary px-3 py-1">
                                      {fmt(item.amount)}
                                    </TableCell>
                                    <TableCell className="text-xs px-3 py-1 text-text-muted">
                                      {item.date || "—"}
                                    </TableCell>
                                    <TableCell className="text-center px-3 py-1">
                                      <Badge variant="outline" className="text-[9px] bg-[#0D94FB]/5 text-[#0D94FB] border-[#0D94FB]/30 font-mono px-1 py-0">
                                        {row.groupType === "1:N" ? `1:${row.items.length}` : `${row.items.length}:1`}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-right px-3 py-1">
                                      <Badge className="bg-emerald-600 text-white text-[9px] font-medium px-1.5 py-0">
                                        <ShieldCheckIcon className="mr-0.5 size-2.5" />
                                        Matched
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </React.Fragment>
                          )
                        }
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 2: Unallocated Cash (Extra Cash: Gateway / Bank records without matching invoices) ── */}
        <TabsContent value="unallocated" className="space-y-3">
          <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
            <CardHeader className="bg-surface-1/60 border-b border-border/50 py-2.5 px-4">
              <div className="flex items-center gap-1.5">
                <BanknoteIcon className="size-4 text-amber-500" />
                <CardTitle className="text-xs font-bold text-text-primary">
                  Unallocated Cash (Extra Cash — Medium Risk)
                </CardTitle>
              </div>
              <CardDescription className="text-[11px] text-text-muted mt-0.5">
                Money physically present in payment gateway or bank accounts that has no corresponding billing invoice in this cycle.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-0 px-0 bg-card">
              <div className="max-h-[420px] overflow-y-auto overflow-x-auto relative rounded-b-xl">
                <Table>
                  <TableHeader className="sticky top-0 bg-surface-1/95 backdrop-blur z-10 shadow-xs">
                    <TableRow className="border-b border-border/60">
                      <TableHead className="w-9 text-center text-[11px] font-semibold text-text-secondary py-2 px-2.5">#</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Stream Type</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Source ID / UTR</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Vendor / Merchant</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-text-secondary py-2 px-3">Unallocated Amount</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Date</TableHead>
                      <TableHead className="text-xs font-semibold text-text-secondary py-2 px-3">Classification &amp; Root Cause</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold text-text-secondary py-2 px-3">Risk Level</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnallocatedCash.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-28 text-center text-xs text-text-muted">
                          <div className="flex flex-col items-center justify-center gap-1">
                            <CheckCircle2Icon className="size-5 text-emerald-500" />
                            <span className="font-semibold text-text-primary">No unallocated cash records found.</span>
                            <span className="text-[11px] text-text-muted">All gateway settlements and bank deposits have matching invoices.</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUnallocatedCash.map((exc, idx) => (
                        <TableRow key={exc.id || idx} className="hover:bg-surface-1/60 transition-colors border-b border-border/40">
                          <TableCell className="text-center font-mono text-[10px] text-text-disabled py-1.5 px-2.5">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 font-medium text-xs text-text-primary">
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30">
                              {exc.type || "Razorpay"}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs font-semibold text-text-primary px-3 py-1.5">
                            {exc.source_id || "—"}
                          </TableCell>
                          <TableCell className="text-xs px-3 py-1.5 max-w-[130px] truncate text-text-primary font-medium">
                            {exc.vendor || "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-amber-600 dark:text-amber-400 px-3 py-1.5">
                            {fmt(exc.amount)}
                          </TableCell>
                          <TableCell className="text-xs px-3 py-1.5 text-text-muted font-mono">
                            {exc.date || "—"}
                          </TableCell>
                          <TableCell className="text-xs px-3 py-1.5 text-text-secondary max-w-sm">
                            <div className="flex items-start gap-1.5">
                              <HelpCircleIcon className="size-3.5 shrink-0 text-amber-500 mt-0.5" />
                              <span>{exc.reason || "Cash received, but no matching invoice in dataset"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center px-3 py-1.5">
                            <span
                              style={{ color: "#F59E0B", backgroundColor: "rgba(245, 158, 11, 0.12)", borderColor: "rgba(245, 158, 11, 0.3)" }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border"
                            >
                              <span className="size-1.5 rounded-full" style={{ backgroundColor: "#F59E0B" }} />
                              Medium
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 3: Exceptions (Missing Cash: Unmatched Invoices & Missing Bank deposits) ── */}
        <TabsContent value="exceptions" className="space-y-3">
          <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
            <CardHeader className="bg-surface-1/60 border-b border-border/50 py-2.5 px-4">
              <div className="flex items-center gap-1.5">
                <AlertTriangleIcon className="size-4 text-destructive" />
                <CardTitle className="text-xs font-bold text-text-primary">
                  Exceptions (Missing Cash — High Risk)
                </CardTitle>
              </div>
              <CardDescription className="text-[11px] text-text-muted mt-0.5">
                Expected revenue or settlements that are not physically present (unmatched billing invoices, settlements missing bank deposits).
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-0 px-0 bg-card">
              <div className="max-h-[420px] overflow-y-auto overflow-x-auto relative rounded-b-xl">
                <Table>
                  <TableHeader className="sticky top-0 bg-surface-1/95 backdrop-blur z-10 shadow-xs">
                    <TableRow className="border-b border-border/60">
                      <TableHead className="w-9 text-center text-[11px] font-semibold text-text-secondary py-2 px-2.5">#</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Stream Type</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Source ID</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Vendor</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-text-secondary py-2 px-3">Amount</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Date</TableHead>
                      <TableHead className="text-xs font-semibold text-text-secondary py-2 px-3">Reason / Description</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold text-text-secondary py-2 px-3">Risk Level</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAuditExceptions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-28 text-center text-xs text-text-muted">
                          <div className="flex flex-col items-center justify-center gap-1">
                            <CheckCircle2Icon className="size-5 text-emerald-500" />
                            <span className="font-semibold text-text-primary">No missing cash exceptions found!</span>
                            <span className="text-[11px] text-text-muted">All billings were successfully captured and deposited.</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAuditExceptions.map((exc, idx) => {
                        const sev = (exc.severity || "High").toLowerCase()
                        const sevColor = sev === "high" ? "#EF4444" : sev === "low" ? "#10B981" : "#F59E0B"
                        const sevLabel = sev === "high" ? "High" : sev === "low" ? "Low" : "Medium"

                        return (
                          <TableRow key={exc.id || idx} className="hover:bg-surface-1/60 transition-colors border-b border-border/40">
                            <TableCell className="text-center font-mono text-[10px] text-text-disabled py-1.5 px-2.5">
                              {idx + 1}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 font-medium text-xs text-text-primary">
                              <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30">
                                {exc.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs font-semibold text-text-primary px-3 py-1.5">
                              {exc.source_id || "—"}
                            </TableCell>
                            <TableCell className="text-xs px-3 py-1.5 max-w-[130px] truncate text-text-primary">
                              {exc.vendor || "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-bold text-rose-600 dark:text-rose-400 px-3 py-1.5">
                              {fmt(exc.amount)}
                            </TableCell>
                            <TableCell className="text-xs px-3 py-1.5 text-text-muted font-mono">
                              {exc.date || "—"}
                            </TableCell>
                            <TableCell className="text-xs px-3 py-1.5 text-text-secondary max-w-sm">
                              <div className="flex items-start gap-1.5">
                                <HelpCircleIcon className="size-3.5 shrink-0 text-rose-500 mt-0.5" />
                                <span>{exc.reason}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center px-3 py-1.5">
                              <span
                                style={{
                                  color: sevColor,
                                  backgroundColor: `${sevColor}1F`,
                                  borderColor: `${sevColor}4D`
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border"
                              >
                                <span className="size-1.5 rounded-full" style={{ backgroundColor: sevColor }} />
                                {sevLabel}
                              </span>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
