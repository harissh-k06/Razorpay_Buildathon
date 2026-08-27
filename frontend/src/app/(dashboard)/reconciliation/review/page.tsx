"use client"

import React, { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { FilePreviewData } from "@/lib/reconciliation-types"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ParamsConfig } from "@/components/reconciliation/ParamsConfig"
import {
  TargetIcon, RefreshCwIcon, Edit2Icon, CheckIcon, XIcon,
  FileTextIcon, CreditCardIcon, Building2Icon,
  AlertCircleIcon, ArrowRightIcon, DatabaseIcon,
  SlidersHorizontalIcon, SparklesIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface EditableTableProps {
  data: FilePreviewData | null
  fileType: "invoice" | "razorpay" | "bank"
  onEditVendor: (rowIndex: number, newVendor: string) => void
}

function formatColumnTitle(col: string): string {
  return col
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Currency Formatter ────────────────────────────────────────────────────────
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  SGD: "S$",
  AED: "AED ",
  CAD: "C$",
  AUD: "A$",
  JPY: "¥",
  CNY: "¥",
}

function formatAmountCell(val: any, col: string, row: Record<string, any>): string {
  if (val == null || val === "") return "—"
  const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ""))
  if (isNaN(num)) return String(val)

  // 1. If column is converted to base currency (INR), always display in ₹
  if (col === "amount_converted" || col === "amount_inr" || col.includes("converted")) {
    return `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  // 2. Identify the row's source currency
  const rawCurr = String(row.currency || row.currency_detected || row.currency_code || "").trim().toUpperCase()
  const symbol = CURRENCY_SYMBOLS[rawCurr] || (rawCurr ? `${rawCurr} ` : "₹")

  // For INR, use en-IN numbering format
  if (rawCurr === "INR") {
    return `${symbol}${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  // For foreign currencies (USD, EUR, GBP, etc.), use en-US format
  return `${symbol}${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Prioritized Standardized Columns Helper (from standardizer.py) ────────────
function getPrioritizedColumns(columns: string[], fileType: "invoice" | "razorpay" | "bank") {
  // Columns created & standardized by standardisation/standardizer.py
  const stdPriority: Record<string, string[]> = {
    invoice: [
      "vendor_standardized",
      "invoice_id", "id",
      "amount_converted",
      "issue_date_standardized", "due_date_standardized", "date_standardized",
      "currency_detected", "currency",
      "description_standardized",
    ],
    razorpay: [
      "vendor_standardized",
      "entity_id", "razorpay_id", "settlement_id", "id",
      "amount_converted",
      "settled_at_standardized", "transaction_date_standardized", "date_standardized",
      "currency_detected", "currency",
      "description_standardized",
      "settlement_utr", "bank_ref_no",
    ],
    bank: [
      "vendor_standardized",
      "ref_no", "bank_ref_no", "utr", "id",
      "amount_converted",
      "value_date_standardized", "transaction_date_standardized", "date_standardized",
      "currency_detected",
      "description_standardized",
    ],
  }

  const priorityList = stdPriority[fileType] || []
  const stdSet = new Set<string>()
  const standardizedCols: string[] = []
  const rawCols: string[] = []

  // 1. Add matched standardized columns first in priority order
  for (const pattern of priorityList) {
    const match = columns.find((c) => c.toLowerCase() === pattern.toLowerCase() && !stdSet.has(c))
    if (match) {
      stdSet.add(match)
      standardizedCols.push(match)
    }
  }

  // 2. Include any other columns containing standardizer flags
  for (const c of columns) {
    const lc = c.toLowerCase()
    if (
      (lc.includes("_standardized") || lc.includes("amount_converted") || lc.includes("currency_detected") || lc.includes("_cleaned")) &&
      !stdSet.has(c)
    ) {
      stdSet.add(c)
      standardizedCols.push(c)
    }
  }

  // 3. All remaining raw columns follow towards the right
  for (const c of columns) {
    if (!stdSet.has(c)) {
      rawCols.push(c)
    }
  }

  return {
    standardized: standardizedCols,
    raw: rawCols,
    ordered: [...standardizedCols, ...rawCols],
  }
}

function EditableTable({ data, fileType, onEditVendor }: EditableTableProps) {
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const [editValue, setEditValue]   = useState("")

  const { standardized, raw, ordered } = useMemo(() => {
    if (!data || !data.columns) return { standardized: [], raw: [], ordered: [] }
    return getPrioritizedColumns(data.columns, fileType)
  }, [data?.columns, fileType])

  if (!data || data.preview.length === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 text-text-muted bg-surface-1/30">
        <DatabaseIcon className="mb-2 size-7 text-text-disabled" />
        <p className="text-xs font-medium">No records available for this stream.</p>
        <p className="text-[11px] text-text-muted mt-0.5">Please standardize files first.</p>
      </div>
    )
  }

  // Identify vendor column
  const vendorKey = ordered.find(
    (k) => k === "vendor_standardized" || k === "vendor_name" || k === "vendor" || k === "counterparty"
  )

  const isAmountCol = (col: string) =>
    col.toLowerCase().includes("amount") ||
    col.toLowerCase().includes("subtotal") ||
    col.toLowerCase().includes("total") ||
    col.toLowerCase().includes("credit") ||
    col.toLowerCase().includes("fee") ||
    col.toLowerCase().includes("tax") ||
    col.toLowerCase().includes("debit") ||
    col.toLowerCase().includes("balance")

  const isDateCol = (col: string) =>
    col.toLowerCase().includes("date") ||
    col.toLowerCase().includes("settled_at")

  const isIdCol = (col: string) =>
    col.toLowerCase().includes("id") ||
    col.toLowerCase().includes("ref") ||
    col.toLowerCase().includes("utr") ||
    col.toLowerCase().includes("number")

  return (
    <div className="space-y-1.5 w-full">
      {/* Direct Table Scroll Container with Visible Horizontal Scrollbar */}
      <div className="table-scrollbar w-full max-h-[400px] rounded-xl border border-border/80 bg-card shadow-2xs relative">
        <table className="w-max min-w-full text-left caption-bottom text-sm border-collapse">
          <thead className="sticky top-0 bg-surface-1/95 backdrop-blur z-10 shadow-xs border-b border-border/60">
            <tr>
              <th className="w-10 text-center text-[11px] font-semibold text-text-secondary py-2.5 px-3 bg-surface-1">
                #
              </th>
              {ordered.map((col) => {
                const isVendor = col === vendorKey
                const isAmt = isAmountCol(col)
                const isStd = standardized.includes(col)

                return (
                  <th
                    key={col}
                    className={cn(
                      "whitespace-nowrap text-[11px] font-semibold py-2.5 px-3.5",
                      isStd ? "text-text-primary bg-surface-1" : "text-text-muted bg-surface-1/60",
                      isAmt && "text-right",
                      isVendor && "min-w-[220px] text-[#0D94FB]"
                    )}
                  >
                    <div className={cn("flex items-center gap-1.5", isAmt && "justify-end")}>
                      <span>{formatColumnTitle(col)}</span>
                      {isStd && (
                        <span className="size-1.5 rounded-full bg-[#0D94FB] shrink-0" title="Standardized Column" />
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-border/40">
            {data.preview.map((row, i) => (
              <tr
                key={i}
                className="hover:bg-surface-1/60 transition-colors border-b border-border/40"
              >
                <td className="text-center font-mono text-[10px] text-text-disabled py-2 px-3">
                  {i + 1}
                </td>

                {ordered.map((col) => {
                  const val = row[col]
                  const isVendor = col === vendorKey
                  const isAmt = isAmountCol(col)
                  const isDate = isDateCol(col)
                  const isId = isIdCol(col)
                  const isStd = standardized.includes(col)

                  if (isVendor) {
                    const vendorStr = String(val ?? "")
                    return (
                      <td key={col} className="py-2 px-3.5 min-w-[220px]">
                        {editingRow === i ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="h-6 text-xs px-2 min-w-[140px] border-[#0D94FB] bg-background focus-visible:ring-1 focus-visible:ring-[#0D94FB]"
                              autoFocus
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6 text-emerald-600 hover:bg-emerald-500/10"
                              onClick={() => {
                                onEditVendor(i, editValue)
                                setEditingRow(null)
                              }}
                            >
                              <CheckIcon className="size-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6 text-destructive hover:bg-destructive/10"
                              onClick={() => setEditingRow(null)}
                            >
                              <XIcon className="size-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2 group/edit">
                            <span className="font-semibold text-xs text-text-primary truncate max-w-[160px]">
                              {vendorStr || "—"}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditValue(vendorStr)
                                setEditingRow(i)
                              }}
                              className="inline-flex items-center gap-1 rounded bg-[#0D94FB]/10 hover:bg-[#0D94FB]/20 text-[#0D94FB] px-1.5 py-0.5 text-[10px] font-semibold transition-all cursor-pointer shrink-0 shadow-2xs"
                              title="Click to edit vendor name"
                            >
                              <Edit2Icon className="size-2.5" />
                              <span>Edit</span>
                            </button>
                          </div>
                        )}
                      </td>
                    )
                  }

                  return (
                    <td
                      key={col}
                      className={cn(
                        "text-xs py-2 px-3.5 max-w-[240px] truncate",
                        isStd ? "text-text-primary" : "text-text-muted",
                        isAmt && "text-right font-mono font-bold text-text-primary",
                        isDate && "font-mono text-text-muted text-[11px]",
                        isId && "font-mono font-medium text-[#0D94FB] text-[11px]"
                      )}
                    >
                      {isAmt ? (
                        formatAmountCell(val, col, row)
                      ) : val != null && val !== "" ? (
                        String(val)
                      ) : (
                        <span className="text-text-disabled font-mono">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Clean Table Footer */}
      <div className="flex items-center justify-end px-1 text-[11px] text-text-muted">
        <span className="font-mono text-text-muted">Total Records: {data.total_rows}</span>
      </div>
    </div>
  )
}

export default function ReviewPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [showParams, setShowParams] = useState(false) // Collapsed by default
  const [activeTab, setActiveTab] = useState<string>("invoice")

  const {
    standardizationStatus, standardizedData, previewData,
    reconciliationStatus, error, reconcile, updateVendorName, loadData,
  } = useReconciliationStore()

  const lastMtimeRef = React.useRef<number>(0)

  useEffect(() => {
    setMounted(true)
    if (typeof loadData === "function") {
      loadData()
    }

    const handleAutoRefresh = () => {
      if (typeof loadData === "function") {
        loadData()
      }
    }

    window.addEventListener("pennywise:data_refresh", handleAutoRefresh)
    window.addEventListener("pennywise:action", handleAutoRefresh)

    return () => {
      window.removeEventListener("pennywise:data_refresh", handleAutoRefresh)
      window.removeEventListener("pennywise:action", handleAutoRefresh)
    }
  }, [loadData])

  const isReconciling = reconciliationStatus === "running"

  const handleRunReconciliation = async () => {
    await reconcile()
    router.push("/reconciliation/results")
  }

  const displayData = {
    invoice:  standardizedData.invoice  || previewData.invoice,
    razorpay: standardizedData.razorpay || previewData.razorpay,
    bank:     standardizedData.bank     || previewData.bank,
  }

  const isStandardized = standardizationStatus === "completed"
  const currentTotalRows = displayData[activeTab as "invoice" | "razorpay" | "bank"]?.total_rows || 0

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto space-y-3">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border/50">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-text-primary">
              Review Standardised Data
            </h1>
            {isStandardized && (
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[9px] px-1.5 py-0">
                <SparklesIcon className="mr-1 size-2.5" /> AI Standardised
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-text-muted mt-0.5">
            Verify standardized vendor entities, adjust tolerance parameters, and run 3-way Hungarian matching.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Toggle Parameters & Tolerances Panel */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowParams((prev) => !prev)}
            className={cn(
              "h-8 text-xs font-medium px-3 transition-all",
              showParams
                ? "bg-[#0D94FB]/10 text-[#0D94FB] border-[#0D94FB]/40 font-semibold"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            <SlidersHorizontalIcon className="mr-1.5 size-3.5 text-[#0D94FB]" />
            {showParams ? "Hide Parameters" : "Parameters & Tolerances"}
          </Button>

          {/* Primary Run Reconciliation Button */}
          <Button
            size="sm"
            disabled={isReconciling}
            onClick={handleRunReconciliation}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-2xs h-8 text-xs px-3.5 min-w-[165px]"
          >
            {isReconciling ? (
              <><RefreshCwIcon className="mr-1.5 size-3.5 animate-spin" /> Matching...</>
            ) : (
              <><TargetIcon className="mr-1.5 size-3.5" /> Run Reconciliation <ArrowRightIcon className="ml-1 size-3" /></>
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start transition-all duration-300">
        {/* Data Streams Inspection Card */}
        <div className={cn("transition-all duration-300", showParams ? "lg:col-span-7" : "lg:col-span-12")}>
          <Card className="border border-border/80 shadow-xs overflow-hidden">
            {/* Stream Navigation Tabs */}
            <div className="bg-surface-1/60 border-b border-border/60 p-2.5 pb-2">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <TabsList className="bg-surface-2 p-0.5 rounded-lg h-8">
                    <TabsTrigger
                      value="invoice"
                      className="text-xs px-3 py-1 font-medium data-[state=active]:bg-[#0D94FB] data-[state=active]:text-white transition-all shadow-2xs"
                    >
                      <FileTextIcon className="mr-1.5 size-3.5" />
                      Invoices
                      {displayData.invoice && (
                        <Badge
                          variant="secondary"
                          className={cn(
                            "ml-1.5 text-[9px] px-1 py-0 font-mono",
                            activeTab === "invoice" ? "bg-white/20 text-white" : "bg-[#0D94FB]/10 text-[#0D94FB]"
                          )}
                        >
                          {displayData.invoice.total_rows}
                        </Badge>
                      )}
                    </TabsTrigger>

                    <TabsTrigger
                      value="razorpay"
                      className="text-xs px-3 py-1 font-medium data-[state=active]:bg-[#0D94FB] data-[state=active]:text-white transition-all shadow-2xs"
                    >
                      <CreditCardIcon className="mr-1.5 size-3.5" />
                      Razorpay Settlements
                      {displayData.razorpay && (
                        <Badge
                          variant="secondary"
                          className={cn(
                            "ml-1.5 text-[9px] px-1 py-0 font-mono",
                            activeTab === "razorpay" ? "bg-white/20 text-white" : "bg-[#0D94FB]/10 text-[#0D94FB]"
                          )}
                        >
                          {displayData.razorpay.total_rows}
                        </Badge>
                      )}
                    </TabsTrigger>

                    <TabsTrigger
                      value="bank"
                      className="text-xs px-3 py-1 font-medium data-[state=active]:bg-[#0D94FB] data-[state=active]:text-white transition-all shadow-2xs"
                    >
                      <Building2Icon className="mr-1.5 size-3.5" />
                      Bank Statement
                      {displayData.bank && (
                        <Badge
                          variant="secondary"
                          className={cn(
                            "ml-1.5 text-[9px] px-1 py-0 font-mono",
                            activeTab === "bank" ? "bg-white/20 text-white" : "bg-[#0D94FB]/10 text-[#0D94FB]"
                          )}
                        >
                          {displayData.bank.total_rows}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <div className="flex items-center gap-1.5 text-xs text-text-muted">
                    <Badge variant="outline" className="text-[10px] border-[#0D94FB]/30 bg-[#0D94FB]/5 text-[#0D94FB] font-medium px-2 py-0.5">
                      {currentTotalRows} Records Ready
                    </Badge>
                  </div>
                </div>

                {/* Tab Contents */}
                <div className="mt-2.5">
                  <TabsContent value="invoice" className="m-0 focus-visible:outline-none">
                    <EditableTable
                      data={displayData.invoice}
                      fileType="invoice"
                      onEditVendor={(i, v) => updateVendorName("invoice", i, v)}
                    />
                  </TabsContent>
                  <TabsContent value="razorpay" className="m-0 focus-visible:outline-none">
                    <EditableTable
                      data={displayData.razorpay}
                      fileType="razorpay"
                      onEditVendor={(i, v) => updateVendorName("razorpay", i, v)}
                    />
                  </TabsContent>
                  <TabsContent value="bank" className="m-0 focus-visible:outline-none">
                    <EditableTable
                      data={displayData.bank}
                      fileType="bank"
                      onEditVendor={(i, v) => updateVendorName("bank", i, v)}
                    />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </Card>
        </div>

        {/* Collapsible Parameters & Tolerances Panel */}
        {showParams && (
          <div className="lg:col-span-5 space-y-3 transition-all duration-300 animate-in fade-in slide-in-from-right-4">
            <ParamsConfig
              onClose={() => setShowParams(false)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
