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
  BanknoteIcon, DollarSignIcon, CheckIcon, XIcon, MessageSquareIcon,
  SparklesIcon, CheckSquareIcon, SquareIcon, CheckSquare2Icon,
} from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { cn, formatCurrency } from "@/lib/utils"
import { ResolveDialog } from "@/components/chatbot/ResolveDialog"
import { MatchRateBarChart } from "@/components/reconciliation/MatchRateBarChart"
import { FinancialFlowChart } from "@/components/reconciliation/FinancialFlowChart"
import { ExceptionPieChart } from "@/components/reconciliation/ExceptionPieChart"

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
            <p className={cn(
              "text-xl font-bold font-mono tracking-tight",
              variant === "success" ? "text-emerald-600 dark:text-emerald-400" :
              variant === "warning" ? "text-amber-600 dark:text-amber-400" :
              variant === "destructive" ? "text-rose-600 dark:text-rose-400" :
              "text-[#0D94FB]"
            )}>
              {value}
            </p>
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
        title: `Settlement: ${settKey}`,
        subtitle: `${groupTrips.length} Invoices grouped into 1 Settlement`,
        vendor: first.vendor || "—",
        totalAmount: totalAmt,
        date: first.date || "—",
        items: groupTrips.map((t, idx) => ({
          id: t.id || `group-item-${idx}`,
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
      const trip = groupTrips[0]
      const invList = trip.invoice_ids || trip.invoice_id.split(",").map((s) => s.trim())
      const partialAmt = trip.amount / (invList.length || 1)
      result.push({
        kind: "group",
        id: `GROUP-N1-MULTI-${trip.id}`,
        groupType: "N:1",
        key: trip.id,
        title: `Settlement: ${trip.razorpay_id || trip.id}`,
        subtitle: `${invList.length} Invoices batched in Single Settlement`,
        vendor: trip.vendor || "—",
        totalAmount: trip.amount,
        date: trip.date || "—",
        items: invList.map((invId, idx) => ({
          id: `${trip.id}-inv-${idx}`,
          invoice_id: invId,
          razorpay_id: trip.razorpay_id,
          bank_ref_no: trip.bank_ref_no,
          vendor: trip.vendor || "—",
          amount: partialAmt,
          date: trip.date || "—",
          match_type: "N:1 Group",
        })),
      })
      processedTripletIds.add(trip.id)
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
  const { results, resetAll, resolveExceptions, agenticMode, loadData, baseCurrency } = useReconciliationStore()
  const [activeTab, setActiveTab] = useState<string>("matched")
  const [search, setSearch] = useState("")
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Selection & Resolution State
  const [selectedExceptionIds, setSelectedExceptionIds] = useState<Set<string>>(new Set())
  const [isResolving, setIsResolving] = useState(false)
  const [resolveModalOpen, setResolveModalOpen] = useState(false)
  const [targetResolveIds, setTargetResolveIds] = useState<string[]>([])
  const [customNote, setCustomNote] = useState("")
  const [resolveMode, setResolveMode] = useState<"direct" | "manual" | "memo">("manual")

  // ResolveDialog state
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false)
  const [resolveDialogException, setResolveDialogException] = useState<ReconciliationException | null>(null)
  const [resolveDialogExceptions, setResolveDialogExceptions] = useState<ReconciliationException[]>([])

  useEffect(() => {
    setMounted(true)
    loadData()
    const handleDataRefresh = () => {
      loadData()
    }
    window.addEventListener("pennywise:data_refresh", handleDataRefresh)
    return () => {
      window.removeEventListener("pennywise:data_refresh", handleDataRefresh)
    }
  }, [loadData])

  // Process grouped rows
  const groupedRows = useMemo(() => groupTriplets(results?.triplets || []), [results?.triplets])

  // Split exceptions into Resolved, Unallocated Cash, and Audit Exceptions
  const resolvedList = useMemo(() => {
    return (results?.exceptions || []).filter((e) => {
      return e.status === "Resolved" || e.status_type === "resolved"
    })
  }, [results?.exceptions])

  const unallocatedCashList = useMemo(() => {
    return (results?.exceptions || []).filter((e) => {
      if (e.status === "Resolved" || e.status_type === "resolved") return false
      if (e.status_type === "unallocated_cash") return true
      const type = e.type.toLowerCase()
      const reason = (e.reason || "").toLowerCase()
      if (type === "razorpay" && (reason.includes("no matching invoice") || reason.includes("without invoice") || reason.includes("unallocated"))) {
        return true
      }
      if (type === "bank" && (reason.includes("no matching invoice") || reason.includes("unallocated") || reason.includes("settlement or invoice"))) {
        return true
      }
      return false
    })
  }, [results?.exceptions])

  const auditExceptionsList = useMemo(() => {
    return (results?.exceptions || []).filter((e) => {
      if (e.status === "Resolved" || e.status_type === "resolved") return false
      if (e.status_type === "exception") return true
      const type = e.type.toLowerCase()
      const reason = (e.reason || "").toLowerCase()
      if (type === "invoice") return true
      if (type === "razorpay" && (reason.includes("no matching bank") || reason.includes("bank deposit"))) return true
      if (type === "bank" && reason.includes("no matching razorpay settlement") && !reason.includes("invoice")) return true
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

  // Filtered rows for Tab 4 (Resolved)
  const filteredResolvedList = useMemo(() => {
    if (!search.trim()) return resolvedList
    const q = search.toLowerCase()
    return resolvedList.filter(
      (e) =>
        e.source_id.toLowerCase().includes(q) ||
        (e.vendor ?? "").toLowerCase().includes(q) ||
        (e.reason ?? "").toLowerCase().includes(q) ||
        (e.resolution_note ?? "").toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q)
    )
  }, [resolvedList, search])

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
    n !== undefined ? formatCurrency(n, baseCurrency || "INR") : "—"

  // Checkbox handlers
  const handleToggleSelectAll = (list: ReconciliationException[]) => {
    const listIds = list.map((e) => e.source_id || e.id)
    const allSelected = listIds.length > 0 && listIds.every((id) => selectedExceptionIds.has(id))
    setSelectedExceptionIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        listIds.forEach((id) => next.delete(id))
      } else {
        listIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const handleToggleRowSelect = (id: string) => {
    setSelectedExceptionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Direct manual resolve (One-Click)
  const handleDirectManualResolve = async (ids: string[], note?: string) => {
    setIsResolving(true)
    const result = await resolveExceptions(ids, "manual", note || "Resolved manually by user")
    setIsResolving(false)
    if (result.success) {
      toast({
        title: "Record(s) Resolved",
        description: `Successfully resolved ${ids.length} record(s) and moved to the Resolved tab.`,
        variant: "success",
      })
      setSelectedExceptionIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      setResolveModalOpen(false)
      setCustomNote("")
    } else {
      toast({
        title: "Resolution Failed",
        description: result.error || "Failed to resolve records.",
        variant: "destructive",
      })
    }
  }

  // Open PennyWise Chat for drafting dispute/unallocated memos
  const handleOpenMemoChat = (ids: string[]) => {
    const prompt = `@resolve_exceptions ids: [${ids.map((id) => `"${id}"`).join(", ")}] mode: memo`
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pennywise:open_and_send", {
          detail: { prompt },
        })
      )
    }
    setResolveModalOpen(false)
    toast({
      title: "PennyWise AI Dispatched",
      description: `Drafting resolution memo for ${ids.length} record(s) in chat window.`,
      variant: "default",
    })
  }

  // Open ResolveDialog for a single exception
  const handleOpenPennyWiseResolve = (exc: ReconciliationException) => {
    setResolveDialogException(exc)
    setResolveDialogExceptions([])
    setResolveDialogOpen(true)
  }

  // Open ResolveDialog for batch selected exceptions
  const handleOpenBatchPennyWiseResolve = (ids: string[]) => {
    const excList = (results?.exceptions || []).filter((e) => ids.includes(e.source_id || e.id))
    setResolveDialogException(null)
    setResolveDialogExceptions(excList)
    setResolveDialogOpen(true)
  }

  // Called when user clicks Continue in the ResolveDialog (single or batch)
  const handleResolveDialogConfirm = (action: "memo" | "email", recipient?: string) => {
    const isBatch = resolveDialogExceptions.length > 0
    if (!resolveDialogException && !isBatch) return

    if (isBatch) {
      const ids = resolveDialogExceptions.map((e) => e.source_id || e.id)
      const totalAmt = resolveDialogExceptions.reduce((sum, e) => sum + (e.amount || 0), 0)
      const count = ids.length

      let prompt: string
      if (action === "email" && recipient) {
        prompt = `Generate resolution email draft(s) for ${count} exceptions (${ids.join(", ")}) totalling ${fmt(totalAmt)} to be sent to ${recipient}. Use the generate_email_from_exception tool with exception_ids=${JSON.stringify(ids)} and recipient_email="${recipient}". Group by vendor into separate email drafts for each counterparty and display the draft cards so I can review and send each.`
      } else {
        prompt = `Please help me resolve these ${count} exception records (${ids.join(", ")}) totalling ${fmt(totalAmt)} and draft formal dispute/allocation resolution memos for each.`
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("pennywise:open_and_send", {
            detail: {
              prompt,
              action,
              recipient: recipient || null,
              exceptionIds: ids,
            },
          })
        )
      }

      toast({
        title: action === "email" ? "Opening PennyWise – Batch Email Flow" : "Opening PennyWise – Batch Memo Flow",
        description: action === "email"
          ? `Drafting consolidated email for ${count} exception(s) to ${recipient}…`
          : `Drafting resolution memos for ${count} record(s) in chat window.`,
        variant: "default",
      })
      return
    }

    // Single exception flow
    const exc = resolveDialogException!
    const excId = exc.source_id || exc.id
    const excType = exc.type || "Exception"
    const vendorStr = exc.vendor ? ` for ${exc.vendor}` : ""
    const amtStr = exc.amount ? ` of ${fmt(exc.amount)}` : ""
    const reasonStr = exc.reason ? ` (${exc.reason})` : ""

    let prompt: string
    if (action === "email" && recipient) {
      prompt = `Generate an email for exception ${excId}${vendorStr}${amtStr}${reasonStr} to be sent to ${recipient}. Use the generate_email_from_exception tool with exception_ids=["${excId}"] and recipient_email="${recipient}". Display the email draft so I can review and send it.`
    } else {
      prompt = `Please help me resolve this ${excType} record ${excId}${vendorStr}${amtStr}${reasonStr} and draft a formal resolution memo.`
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pennywise:open_and_send", {
          detail: {
            prompt,
            action,
            exceptionId: excId,
            exceptionIds: [excId],
            recipient: recipient || null,
            exceptionData: {
              id: excId,
              type: excType,
              vendor: exc.vendor,
              amount: exc.amount,
              reason: exc.reason,
            },
          },
        })
      )
    }

    toast({
      title: action === "email" ? "Opening PennyWise – Email Flow" : "Opening PennyWise – Memo Flow",
      description: action === "email"
        ? `Drafting email for ${excId} to ${recipient}…`
        : `Drafting resolution memo for ${excId} in chat window.`,
      variant: "default",
    })
  }

  const handleOpenCustomNoteModal = (ids: string[]) => {
    setTargetResolveIds(ids)
    setCustomNote("")
    setResolveMode("direct")
    setResolveModalOpen(true)
  }

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

  const matchedTripletsCount = results.matchedTripletsCount || results.triplets?.length || results.matchedCount || 0
  const totalCount = results.totalCount || results.matchedInvoicesCount || 200

  // 4-Way Reconciliation Universe: Matched Triplets + Unallocated Cash + Exceptions + Resolved
  const unallocatedCount = unallocatedCashList.length
  const auditExceptionsCount = auditExceptionsList.length
  const resolvedCount = resolvedList.length
  const totalResolvedAmount = resolvedList.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)

  // Live Dynamic Invoice Match Rate (Increases towards 100% as invoice exceptions are resolved)
  const allInvoiceExceptions = (results.exceptions || []).filter((e) => e.type?.toLowerCase() === "invoice")
  const openInvoiceExceptions = allInvoiceExceptions.filter((e) => e.status !== "Resolved" && e.status_type !== "resolved")
  const invoiceExceptionCount = openInvoiceExceptions.length
  const invoiceTotalCount = (results as any).totalInvoices || (results.matchedInvoicesCount ? results.matchedInvoicesCount + allInvoiceExceptions.length : 200)
  const invoiceMatchedCount = Math.max(0, invoiceTotalCount - invoiceExceptionCount)
  const invoiceUnmatchedCount = invoiceExceptionCount
  const invoiceMatchRateNum = invoiceTotalCount > 0 ? +((invoiceMatchedCount / invoiceTotalCount) * 100).toFixed(1) : 100

  // Live Dynamic Record Coverage Rate (Increases towards 100% as records are resolved)
  const totalTriplets = matchedTripletsCount
  const totalExceptions = results.exceptions?.length || (unallocatedCount + auditExceptionsCount + resolvedCount)
  const totalAuditUniverse = matchedTripletsCount + unallocatedCount + auditExceptionsCount + resolvedCount || 1
  const recordCoverageRate = totalAuditUniverse > 0
    ? +(((matchedTripletsCount + resolvedCount) / totalAuditUniverse) * 100).toFixed(1)
    : 100

  const n1Count = groupedRows.filter((r) => r.kind === "group" && r.groupType === "N:1").length
  const oneNCount = groupedRows.filter((r) => r.kind === "group" && r.groupType === "1:N").length

  // Dynamically computed live financial breakdown values for Waterfall Chart
  const grossInvoicedAmount = results.totalInvoiceAmount || 0
  const invoiceTaxAmount = results.totalInvoiceTax !== undefined && results.totalInvoiceTax !== null
    ? results.totalInvoiceTax
    : (results.totalInvoiceSubtotal ? Math.max(0, grossInvoicedAmount - results.totalInvoiceSubtotal) : 0)
  const bankCreditAmount = results.totalBankCredit ?? results.totalSettledAmount ?? 0
  const feesAmount = results.totalFeeAmount !== undefined && results.totalFeeAmount !== null
    ? results.totalFeeAmount
    : (results.totalGrossSettlement ? Math.max(0, results.totalGrossSettlement - (results.totalSettledAmount || 0)) : 0)

  // Live dynamic Missing Cash & Unallocated Cash computed directly from active filtered lists
  const uncollectedExceptionsAmount = auditExceptionsList.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const unallocatedCashAmount = unallocatedCashList.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const liveDiscrepancyAmount = Math.max(0, uncollectedExceptionsAmount + feesAmount)

  return (
    <div className="p-4 sm:p-5 max-w-7xl mx-auto space-y-4 relative pb-20">
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

      {/* 1. Top Section: 4 Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Total Invoiced Amount"
          value={fmt(results.totalInvoiceAmount)}
          sub="Gross accounts receivable billing volume (Gross Target)"
          icon={<TrendingUpIcon className="size-4" />}
        />
        <SummaryCard
          title="Total Settled &amp; Credited"
          value={fmt(results.totalSettledAmount)}
          sub="Gross bank receipts (Combines net revenue, tax & unallocated cash)"
          icon={<CheckCircle2Icon className="size-4" />}
          variant="success"
        />
        <SummaryCard
          title="Discrepancy Variance"
          value={fmt(liveDiscrepancyAmount)}
          sub={liveDiscrepancyAmount > 0 ? "Billed vs. bank receipts delta (Uncollected invoices + gateway deductions)" : "Zero invoice discrepancy"}
          icon={<AlertTriangleIcon className="size-4" />}
          variant={liveDiscrepancyAmount > 0 ? "warning" : "success"}
        />
        <SummaryCard
          title="Resolved Records"
          value={`${resolvedCount} resolved`}
          sub={totalResolvedAmount > 0 ? `${fmt(totalResolvedAmount)} accounted` : "Audited & closed items"}
          icon={<ShieldCheckIcon className="size-4" />}
          variant="success"
        />
      </div>

      {/* 2. Visualizations Row: Donut Chart (Coverage) + Match Rate Bar Chart (Invoice Derivation) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Donut Chart - Record Coverage Universe */}
        <ExceptionPieChart
          matchedCount={matchedTripletsCount}
          unallocatedCount={unallocatedCount}
          exceptionsCount={auditExceptionsCount}
          resolvedCount={resolvedCount}
          totalAuditUniverse={totalAuditUniverse}
          recordCoverageRate={recordCoverageRate}
          totalTriplets={totalTriplets}
          totalExceptions={totalExceptions}
        />

        {/* New: Invoice Match Rate Bar Chart */}
        <MatchRateBarChart
          matched={invoiceMatchedCount}
          unmatched={invoiceUnmatchedCount}
          total={invoiceTotalCount}
          matchRate={invoiceMatchRateNum}
        />
      </div>

      {/* 3. Financial Flow Horizontal Bar Chart (Full Width) */}
      <FinancialFlowChart
        gross={grossInvoicedAmount}
        bank={bankCreditAmount}
        invoiceTax={invoiceTaxAmount}
        fees={feesAmount}
        uncollected={uncollectedExceptionsAmount}
        unallocated={unallocatedCashAmount}
        baseCurrency={baseCurrency}
      />

      {/* 3. Below: 4 Distinct Tabs (Matched Triplets | Unallocated Cash | Exceptions | Resolved) */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-border/60 pb-2">
          <TabsList className="bg-surface-2 p-1 rounded-xl flex flex-wrap sm:flex-nowrap gap-1 h-auto group-data-horizontal/tabs:h-auto w-full sm:w-auto">
            {/* Tab 1: Matched Triplets */}
            <TabsTrigger
              value="matched"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg data-[state=active]:bg-background data-active:bg-background data-[state=active]:text-[#0D94FB] data-active:text-[#0D94FB] data-[state=active]:shadow-xs data-active:shadow-xs transition-all h-8 inline-flex items-center gap-1.5 shrink-0"
            >
              <CheckCircle2Icon className="size-3.5 text-[#0D94FB]" />
              Matched Triplets
              <Badge
                variant="secondary"
                className="ml-1 text-[10px] px-1.5 py-0 font-mono font-bold bg-[#0D94FB]/10 text-[#0D94FB] border border-[#0D94FB]/20"
              >
                {results.triplets?.length || 0}
              </Badge>
            </TabsTrigger>

            {/* Tab 2: Unallocated Cash */}
            <TabsTrigger
              value="unallocated"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg data-[state=active]:bg-background data-active:bg-background data-[state=active]:text-amber-600 dark:data-[state=active]:text-amber-400 data-active:text-amber-600 dark:data-active:text-amber-400 data-[state=active]:shadow-xs data-active:shadow-xs transition-all h-8 inline-flex items-center gap-1.5 shrink-0"
            >
              <BanknoteIcon className="size-3.5 text-amber-500" />
              Unallocated Cash
              <Badge
                variant="secondary"
                className="ml-1 text-[10px] px-1.5 py-0 font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
              >
                {unallocatedCashList.length}
              </Badge>
            </TabsTrigger>

            {/* Tab 3: Exceptions */}
            <TabsTrigger
              value="exceptions"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg data-[state=active]:bg-background data-active:bg-background data-[state=active]:text-destructive data-active:text-destructive data-[state=active]:shadow-xs data-active:shadow-xs transition-all h-8 inline-flex items-center gap-1.5 shrink-0"
            >
              <AlertTriangleIcon className="size-3.5 text-destructive" />
              Exceptions
              <Badge
                variant="secondary"
                className={`ml-1 text-[10px] px-1.5 py-0 font-mono font-bold ${
                  auditExceptionsList.length > 0
                    ? "bg-destructive/10 text-destructive border border-destructive/20"
                    : "bg-muted text-text-muted border border-border"
                }`}
              >
                {auditExceptionsList.length}
              </Badge>
            </TabsTrigger>

            {/* Tab 4: Resolved (NEW) */}
            <TabsTrigger
              value="resolved"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg data-[state=active]:bg-background data-active:bg-background data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400 data-active:text-emerald-600 dark:data-active:text-emerald-400 data-[state=active]:shadow-xs data-active:shadow-xs transition-all h-8 inline-flex items-center gap-1.5 shrink-0"
            >
              <ShieldCheckIcon className="size-3.5 text-emerald-500" />
              Resolved
              <Badge
                variant="secondary"
                className="ml-1 text-[10px] px-1.5 py-0 font-mono font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
              >
                {resolvedList.length}
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
                    : activeTab === "resolved"
                    ? "Search Resolved Items..."
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
            ) : activeTab === "resolved" ? (
              <Button
                size="sm"
                onClick={() => exportCSV(resolvedList, "resolved_exceptions.csv")}
                className="h-7.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-600/90 text-white shadow-2xs px-3"
              >
                <DownloadIcon className="mr-1.5 size-3.5" /> Export Resolved CSV
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

        {/* ── TAB 2: Unallocated Cash ────────────────────────────────────────── */}
        <TabsContent value="unallocated" className="space-y-3">
          <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
            <CardHeader className="bg-surface-1/60 border-b border-border/50 py-2.5 px-4 flex flex-row items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <BanknoteIcon className="size-4 text-amber-500" />
                  <CardTitle className="text-xs font-bold text-text-primary">
                    Unallocated Cash (Extra Cash — Medium Risk)
                  </CardTitle>
                </div>
                <CardDescription className="text-[11px] text-text-muted mt-0.5">
                  Money physically present in payment gateway or bank accounts without a matching billing invoice.
                </CardDescription>
              </div>

              {filteredUnallocatedCash.length > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleSelectAll(filteredUnallocatedCash)}
                    className="h-6.5 text-[11px] font-medium px-2"
                  >
                    {filteredUnallocatedCash.every((e) => selectedExceptionIds.has(e.source_id || e.id)) ? (
                      <>
                        <CheckSquare2Icon className="mr-1 size-3 text-[#0D94FB]" /> Deselect All
                      </>
                    ) : (
                      <>
                        <SquareIcon className="mr-1 size-3 text-text-muted" /> Select All ({filteredUnallocatedCash.length})
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardHeader>

            <CardContent className="pt-0 px-0 bg-card">
              <div className="max-h-[420px] overflow-y-auto overflow-x-auto relative rounded-b-xl">
                <Table>
                  <TableHeader className="sticky top-0 bg-surface-1/95 backdrop-blur z-10 shadow-xs">
                    <TableRow className="border-b border-border/60">
                      <TableHead className="w-8 text-center py-2 px-2">
                        <input
                          type="checkbox"
                          checked={filteredUnallocatedCash.length > 0 && filteredUnallocatedCash.every((e) => selectedExceptionIds.has(e.source_id || e.id))}
                          onChange={() => handleToggleSelectAll(filteredUnallocatedCash)}
                          className="rounded border-border size-3.5 accent-[#0D94FB] cursor-pointer align-middle"
                        />
                      </TableHead>
                      <TableHead className="w-9 text-center text-[11px] font-semibold text-text-secondary py-2 px-2.5">#</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Stream Type</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Source ID / UTR</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Vendor / Merchant</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-text-secondary py-2 px-3">Unallocated Amount</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Date</TableHead>
                      <TableHead className="text-xs font-semibold text-text-secondary py-2 px-3">Classification &amp; Root Cause</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold text-text-secondary py-2 px-3">Risk Level</TableHead>
                      <TableHead className="w-56 text-right text-[11px] font-semibold text-text-secondary py-2 px-3 sticky right-0 bg-surface-1/95 z-20 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnallocatedCash.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="h-28 text-center text-xs text-text-muted">
                          <div className="flex flex-col items-center justify-center gap-1">
                            <CheckCircle2Icon className="size-5 text-emerald-500" />
                            <span className="font-semibold text-text-primary">No unallocated cash records pending.</span>
                            <span className="text-[11px] text-text-muted">All gateway settlements and bank deposits have matching invoices or are resolved.</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUnallocatedCash.map((exc, idx) => {
                        const excId = exc.source_id || exc.id
                        const isSelected = selectedExceptionIds.has(excId)

                        return (
                          <TableRow
                            key={exc.id || idx}
                            className={cn(
                              "transition-colors border-b border-border/40",
                              isSelected ? "bg-[#0D94FB]/5 hover:bg-[#0D94FB]/10" : "hover:bg-surface-1/60"
                            )}
                          >
                            <TableCell className="text-center py-1.5 px-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleRowSelect(excId)}
                                className="rounded border-border size-3.5 accent-[#0D94FB] cursor-pointer align-middle"
                              />
                            </TableCell>
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
                            <TableCell className="text-right px-3 py-1.5 sticky right-0 bg-background/95 backdrop-blur z-10 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                              <div className="flex items-center justify-end gap-1.5">
                                {/* 1. Direct Resolve */}
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handleDirectManualResolve([excId])}
                                  disabled={isResolving}
                                  className="h-6.5 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-2xs cursor-pointer shrink-0"
                                  title="Directly resolve this record"
                                >
                                  <CheckIcon className="size-3 mr-1" />
                                  Resolve
                                </Button>

                                {/* 2. Resolve with PennyWise (AI Gemini sparkle) */}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenPennyWiseResolve(exc)}
                                  className="h-6.5 px-2.5 text-[11px] font-medium border-[#0D94FB]/40 bg-[#0D94FB]/10 hover:bg-[#0D94FB]/20 text-[#0D94FB] shadow-2xs flex items-center gap-1 cursor-pointer shrink-0"
                                  title="Open in PennyWise AI to draft memo & resolve"
                                >
                                  <span className="text-xs select-none">✨</span>
                                  <span>PennyWise</span>
                                </Button>
                              </div>
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

        {/* ── TAB 3: Exceptions (Missing Cash) ────────────────────────────────── */}
        <TabsContent value="exceptions" className="space-y-3">
          <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
            <CardHeader className="bg-surface-1/60 border-b border-border/50 py-2.5 px-4 flex flex-row items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <AlertTriangleIcon className="size-4 text-destructive" />
                  <CardTitle className="text-xs font-bold text-text-primary">
                    Exceptions (Missing Cash — High Risk)
                  </CardTitle>
                </div>
                <CardDescription className="text-[11px] text-text-muted mt-0.5">
                  Expected revenue or settlements that are not physically present (unmatched billing invoices, settlements missing bank deposits).
                </CardDescription>
              </div>

              {filteredAuditExceptions.length > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleSelectAll(filteredAuditExceptions)}
                    className="h-6.5 text-[11px] font-medium px-2"
                  >
                    {filteredAuditExceptions.every((e) => selectedExceptionIds.has(e.source_id || e.id)) ? (
                      <>
                        <CheckSquare2Icon className="mr-1 size-3 text-[#0D94FB]" /> Deselect All
                      </>
                    ) : (
                      <>
                        <SquareIcon className="mr-1 size-3 text-text-muted" /> Select All ({filteredAuditExceptions.length})
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardHeader>

            <CardContent className="pt-0 px-0 bg-card">
              <div className="max-h-[420px] overflow-y-auto overflow-x-auto relative rounded-b-xl">
                <Table>
                  <TableHeader className="sticky top-0 bg-surface-1/95 backdrop-blur z-10 shadow-xs">
                    <TableRow className="border-b border-border/60">
                      <TableHead className="w-8 text-center py-2 px-2">
                        <input
                          type="checkbox"
                          checked={filteredAuditExceptions.length > 0 && filteredAuditExceptions.every((e) => selectedExceptionIds.has(e.source_id || e.id))}
                          onChange={() => handleToggleSelectAll(filteredAuditExceptions)}
                          className="rounded border-border size-3.5 accent-[#0D94FB] cursor-pointer align-middle"
                        />
                      </TableHead>
                      <TableHead className="w-9 text-center text-[11px] font-semibold text-text-secondary py-2 px-2.5">#</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Stream Type</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Source ID</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Vendor</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-text-secondary py-2 px-3">Amount</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Date</TableHead>
                      <TableHead className="text-xs font-semibold text-text-secondary py-2 px-3">Reason / Description</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold text-text-secondary py-2 px-3">Risk Level</TableHead>
                      <TableHead className="w-56 text-right text-[11px] font-semibold text-text-secondary py-2 px-3 sticky right-0 bg-surface-1/95 z-20 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAuditExceptions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="h-28 text-center text-xs text-text-muted">
                          <div className="flex flex-col items-center justify-center gap-1">
                            <CheckCircle2Icon className="size-5 text-emerald-500" />
                            <span className="font-semibold text-text-primary">No missing cash exceptions pending!</span>
                            <span className="text-[11px] text-text-muted">All billings were successfully captured and deposited or resolved.</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAuditExceptions.map((exc, idx) => {
                        const excId = exc.source_id || exc.id
                        const isSelected = selectedExceptionIds.has(excId)
                        const sev = (exc.severity || "High").toLowerCase()
                        const sevColor = sev === "high" ? "#EF4444" : sev === "low" ? "#10B981" : "#F59E0B"
                        const sevLabel = sev === "high" ? "High" : sev === "low" ? "Low" : "Medium"

                        return (
                          <TableRow
                            key={exc.id || idx}
                            className={cn(
                              "transition-colors border-b border-border/40",
                              isSelected ? "bg-[#0D94FB]/5 hover:bg-[#0D94FB]/10" : "hover:bg-surface-1/60"
                            )}
                          >
                            <TableCell className="text-center py-1.5 px-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleRowSelect(excId)}
                                className="rounded border-border size-3.5 accent-[#0D94FB] cursor-pointer align-middle"
                              />
                            </TableCell>
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
                            <TableCell className="text-right px-3 py-1.5 sticky right-0 bg-background/95 backdrop-blur z-10 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                              <div className="flex items-center justify-end gap-1.5">
                                {/* 1. Direct Resolve */}
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handleDirectManualResolve([excId])}
                                  disabled={isResolving}
                                  className="h-6.5 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-2xs cursor-pointer shrink-0"
                                  title="Directly resolve this exception"
                                >
                                  <CheckIcon className="size-3 mr-1" />
                                  Resolve
                                </Button>

                                {/* 2. Resolve with PennyWise (AI Gemini sparkle) */}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenPennyWiseResolve(exc)}
                                  className="h-6.5 px-2.5 text-[11px] font-medium border-[#0D94FB]/40 bg-[#0D94FB]/10 hover:bg-[#0D94FB]/20 text-[#0D94FB] shadow-2xs flex items-center gap-1 cursor-pointer shrink-0"
                                  title="Open in PennyWise AI to draft memo & resolve"
                                >
                                  <span className="text-xs select-none">✨</span>
                                  <span>PennyWise</span>
                                </Button>
                              </div>
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

        {/* ── TAB 4: Resolved (NEW) ───────────────────────────────────────────── */}
        <TabsContent value="resolved" className="space-y-3">
          <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
            <CardHeader className="bg-surface-1/60 border-b border-border/50 py-2.5 px-4 flex flex-row items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheckIcon className="size-4 text-emerald-500" />
                  <CardTitle className="text-xs font-bold text-text-primary">
                    Resolved Audit Registry
                  </CardTitle>
                </div>
                <CardDescription className="text-[11px] text-text-muted mt-0.5">
                  Exceptions and unallocated entries manually cleared, reconciled offline, or verified by controller notes.
                </CardDescription>
              </div>

              {resolvedList.length > 0 && (
                <Badge variant="outline" className="text-[10px] font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                  {resolvedList.length} items settled ({fmt(totalResolvedAmount)})
                </Badge>
              )}
            </CardHeader>

            <CardContent className="pt-0 px-0 bg-card">
              <div className="max-h-[420px] overflow-y-auto overflow-x-auto relative rounded-b-xl">
                <Table>
                  <TableHeader className="sticky top-0 bg-surface-1/95 backdrop-blur z-10 shadow-xs">
                    <TableRow className="border-b border-border/60">
                      <TableHead className="w-9 text-center text-[11px] font-semibold text-text-secondary py-2 px-2.5">#</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Stream Type</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Source ID</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Vendor / Counterparty</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-text-secondary py-2 px-3">Amount</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Original Date</TableHead>
                      <TableHead className="text-xs font-semibold text-text-secondary py-2 px-3">Original Issue</TableHead>
                      <TableHead className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 py-2 px-3">Resolution Note &amp; Audit Trail</TableHead>
                      <TableHead className="text-[11px] font-semibold text-text-secondary py-2 px-3">Resolved At</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold text-text-secondary py-2 px-3">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredResolvedList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="h-28 text-center text-xs text-text-muted">
                          <div className="flex flex-col items-center justify-center gap-1">
                            <ShieldCheckIcon className="size-5 text-text-disabled" />
                            <span className="font-semibold text-text-primary">No resolved records in this audit cycle.</span>
                            <span className="text-[11px] text-text-muted">Use the "Resolve" button on any exception or unallocated cash item to clear it.</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredResolvedList.map((exc, idx) => (
                        <TableRow key={exc.id || idx} className="hover:bg-surface-1/60 transition-colors border-b border-border/40 bg-emerald-500/5">
                          <TableCell className="text-center font-mono text-[10px] text-text-disabled py-1.5 px-2.5">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="px-3 py-1.5 font-medium text-xs text-text-primary">
                            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                              {exc.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs font-semibold text-text-primary px-3 py-1.5">
                            {exc.source_id || "—"}
                          </TableCell>
                          <TableCell className="text-xs px-3 py-1.5 max-w-[130px] truncate text-text-primary font-medium">
                            {exc.vendor || "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 px-3 py-1.5">
                            {fmt(exc.amount)}
                          </TableCell>
                          <TableCell className="text-xs px-3 py-1.5 text-text-muted font-mono">
                            {exc.date || "—"}
                          </TableCell>
                          <TableCell className="text-xs px-3 py-1.5 text-text-secondary max-w-xs truncate">
                            {exc.reason || "Audited record"}
                          </TableCell>
                          <TableCell className="text-xs px-3 py-1.5 text-emerald-800 dark:text-emerald-300 font-medium max-w-sm">
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-600" />
                              <span>{exc.resolution_note || "Resolved manually by user"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs px-3 py-1.5 text-text-muted font-mono text-[10px]">
                            {exc.resolved_at || "Audit Finalized"}
                          </TableCell>
                          <TableCell className="text-right px-3 py-1.5">
                            <Badge className="bg-emerald-600 text-white text-[9px] font-medium px-2 py-0.5">
                              <ShieldCheckIcon className="mr-0.5 size-2.5" />
                              Resolved
                            </Badge>
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
      </Tabs>

      {/* ── FLOATING BULK RESOLUTION ACTION BAR ──────────────────────────────── */}
      {selectedExceptionIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-surface-1/95 border border-[#0D94FB]/40 shadow-2xl backdrop-blur-md px-4 py-2.5 rounded-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-2 pr-2 border-r border-border">
            <span className="flex size-5 items-center justify-center rounded-full bg-[#0D94FB] text-[10px] font-bold text-white">
              {selectedExceptionIds.size}
            </span>
            <span className="text-xs font-semibold text-text-primary">
              Record(s) Selected
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => handleDirectManualResolve(Array.from(selectedExceptionIds))}
              disabled={isResolving}
              className="h-8 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
            >
              <CheckIcon className="mr-1.5 size-3.5" />
              One-Click Resolve
            </Button>

            <Button
              size="sm"
              onClick={() => handleOpenBatchPennyWiseResolve(Array.from(selectedExceptionIds))}
              className="h-8 text-xs font-semibold bg-[#0D94FB] hover:bg-[#0D94FB]/90 text-white shadow-xs flex items-center gap-1.5"
            >
              <span className="text-xs select-none">✨</span>
              <span>Resolve with PennyWise</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => handleOpenCustomNoteModal(Array.from(selectedExceptionIds))}
              className="h-8 text-xs font-medium"
            >
              <MessageSquareIcon className="mr-1.5 size-3.5 text-text-muted" />
              Add Note...
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedExceptionIds(new Set())}
              className="h-8 px-2 text-xs text-text-muted hover:text-destructive"
              title="Clear selection"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── RESOLUTION WORKFLOW MODAL DIALOG ──────────────────────────────────── */}
      {resolveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <Card className="w-full max-w-md bg-card border-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <CardHeader className="bg-surface-1/80 border-b border-border/60 pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                    <ShieldCheckIcon className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-text-primary">
                      Resolve Reconciliation Exception(s)
                    </CardTitle>
                    <CardDescription className="text-[11px] text-text-muted">
                      Resolving {targetResolveIds.length} selected record(s)
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-text-muted hover:text-text-primary"
                  onClick={() => setResolveModalOpen(false)}
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
                <Button type="button" variant="outline" size="sm" onClick={() => handleOpenMemoChat(targetResolveIds)} className="text-xs text-[#0D94FB] border-[#0D94FB]/30 hover:bg-[#0D94FB]/10 h-8">
                  <MessageSquareIcon className="mr-1.5 size-3.5" />Draft Memo via Chat
                </Button>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setResolveModalOpen(false)} className="text-xs h-8">Cancel</Button>
                  <Button type="button" size="sm" disabled={isResolving} onClick={() => handleDirectManualResolve(targetResolveIds, customNote.trim() || "Resolved with controller note")} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold h-8 px-3">
                    <CheckIcon className="mr-1.5 size-3.5" />Confirm &amp; Resolve
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ResolveDialog – PennyWise Draft Memo / Send Email */}
      <ResolveDialog
        open={resolveDialogOpen}
        onClose={() => {
          setResolveDialogOpen(false)
          setResolveDialogException(null)
          setResolveDialogExceptions([])
        }}
        exception={resolveDialogException}
        exceptions={resolveDialogExceptions}
        onConfirm={handleResolveDialogConfirm}
      />
    </div>
  )
}