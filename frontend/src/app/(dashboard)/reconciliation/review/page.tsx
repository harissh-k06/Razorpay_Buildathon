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
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { fetchDataStatus } from "@/lib/api"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

interface EditableTableProps {
  data: FilePreviewData | null
  fileType: "invoice" | "razorpay" | "bank"
  onUpdateRow: (
    rowIndex: number,
    rowId: string | number | null,
    updatedData: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>
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

function EditableTable({ data, fileType, onUpdateRow }: EditableTableProps) {
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null)
  const [editRowData, setEditRowData] = useState<Record<string, any>>({})
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(20)

  // Reset page and cancel edit when fileType or dataset changes
  useEffect(() => {
    setCurrentPage(1)
    setEditingRowIndex(null)
    setEditRowData({})
  }, [fileType, data?.preview?.length])

  const { standardized, raw, ordered } = useMemo(() => {
    if (!data || !data.columns) return { standardized: [], raw: [], ordered: [] }
    return getPrioritizedColumns(data.columns, fileType)
  }, [data?.columns, fileType])

  if (!data || data.preview.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 text-text-muted bg-surface-1/30">
        <DatabaseIcon className="mb-2 size-7 text-text-disabled" />
        <p className="text-xs font-medium">No records available for this stream.</p>
        <p className="text-[11px] text-text-muted mt-0.5">Please standardize files first.</p>
      </div>
    )
  }

  const totalRecords = data.preview.length
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize))
  const validPage = Math.min(currentPage, totalPages)
  const startIndex = (validPage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, totalRecords)
  const currentRows = data.preview.slice(startIndex, endIndex)

  const handleStartEdit = (globalIdx: number, row: Record<string, any>) => {
    setEditingRowIndex(globalIdx)
    setEditRowData({ ...row })
  }

  const handleCancelEdit = () => {
    setEditingRowIndex(null)
    setEditRowData({})
  }

  const handleCellChange = (col: string, val: string) => {
    setEditRowData((prev) => ({
      ...prev,
      [col]: val,
    }))
  }

  const handleSaveRow = async (globalIdx: number) => {
    setIsSaving(true)
    const rowId =
      editRowData.invoice_id ||
      editRowData.entity_id ||
      editRowData.razorpay_id ||
      editRowData.settlement_id ||
      editRowData.ref_no ||
      editRowData.bank_ref_no ||
      editRowData.utr ||
      editRowData.id ||
      null

    const result = await onUpdateRow(globalIdx, rowId, editRowData)
    setIsSaving(false)

    if (result.success) {
      toast({
        title: "Row Saved",
        description: `Row #${globalIdx + 1} updated and saved to ${fileType}_standardized.csv`,
        variant: "success",
      })
      setEditingRowIndex(null)
      setEditRowData({})
    } else {
      toast({
        title: "Save Failed",
        description: result.error || "Failed to update row.",
        variant: "destructive",
      })
    }
  }

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

  // Generate pagination range items
  const renderPaginationItems = () => {
    const items = []
    const maxVisible = 5

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        items.push(
          <PaginationItem key={i}>
            <PaginationLink
              isActive={validPage === i}
              onClick={() => setCurrentPage(i)}
            >
              {i}
            </PaginationLink>
          </PaginationItem>
        )
      }
    } else {
      items.push(
        <PaginationItem key={1}>
          <PaginationLink
            isActive={validPage === 1}
            onClick={() => setCurrentPage(1)}
          >
            1
          </PaginationLink>
        </PaginationItem>
      )

      if (validPage > 3) {
        items.push(
          <PaginationItem key="ellipsis-start">
            <PaginationEllipsis />
          </PaginationItem>
        )
      }

      const start = Math.max(2, validPage - 1)
      const end = Math.min(totalPages - 1, validPage + 1)

      for (let i = start; i <= end; i++) {
        items.push(
          <PaginationItem key={i}>
            <PaginationLink
              isActive={validPage === i}
              onClick={() => setCurrentPage(i)}
            >
              {i}
            </PaginationLink>
          </PaginationItem>
        )
      }

      if (validPage < totalPages - 2) {
        items.push(
          <PaginationItem key="ellipsis-end">
            <PaginationEllipsis />
          </PaginationItem>
        )
      }

      items.push(
        <PaginationItem key={totalPages}>
          <PaginationLink
            isActive={validPage === totalPages}
            onClick={() => setCurrentPage(totalPages)}
          >
            {totalPages}
          </PaginationLink>
        </PaginationItem>
      )
    }

    return items
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full space-y-2.5">
      {/* Scroll Container with sticky header filling vertical space */}
      <div className="table-scrollbar flex-1 min-h-[380px] max-h-[calc(100vh-235px)] overflow-auto rounded-xl border border-border/80 bg-card shadow-2xs relative">
        <table className="w-max min-w-full text-left caption-bottom text-sm border-collapse">
          <thead className="sticky top-0 bg-surface-1/95 backdrop-blur z-10 shadow-xs border-b border-border/60">
            <tr>
              <th className="w-12 text-center text-[11px] font-semibold text-text-secondary py-2.5 px-3 bg-surface-1">
                #
              </th>
              {ordered.map((col) => {
                const isAmt = isAmountCol(col)
                const isStd = standardized.includes(col)

                return (
                  <th
                    key={col}
                    className={cn(
                      "whitespace-nowrap text-[11px] font-semibold py-2.5 px-3.5",
                      isStd ? "text-text-primary bg-surface-1" : "text-text-muted bg-surface-1/60",
                      isAmt && "text-right"
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
              <th className="w-32 text-right text-[11px] font-semibold text-text-secondary py-2.5 px-3 bg-surface-1 sticky right-0 z-20 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border/40">
            {currentRows.map((row, localIdx) => {
              const globalIdx = startIndex + localIdx
              const isEditing = editingRowIndex === globalIdx

              return (
                <tr
                  key={globalIdx}
                  className={cn(
                    "transition-colors border-b border-border/40",
                    isEditing
                      ? "bg-[#0D94FB]/5 hover:bg-[#0D94FB]/10 border-b-2 border-b-[#0D94FB]/40"
                      : "hover:bg-surface-1/60"
                  )}
                >
                  <td className="text-center font-mono text-[10px] text-text-disabled py-2 px-3">
                    {globalIdx + 1}
                  </td>

                  {ordered.map((col) => {
                    const rawVal = row[col]
                    const isAmt = isAmountCol(col)
                    const isDate = isDateCol(col)
                    const isId = isIdCol(col)
                    const isStd = standardized.includes(col)

                    if (isEditing) {
                      const currentVal = editRowData[col] ?? rawVal ?? ""
                      return (
                        <td key={col} className="py-1 px-2 min-w-[140px]">
                          <Input
                            value={currentVal}
                            disabled={isSaving}
                            onChange={(e) => handleCellChange(col, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRow(globalIdx)
                              if (e.key === "Escape") handleCancelEdit()
                            }}
                            className={cn(
                              "h-7 text-xs px-2 w-full bg-background border-border/80 focus-visible:ring-1 focus-visible:ring-[#0D94FB] font-sans",
                              isAmt && "text-right font-mono font-medium",
                              isId && "font-mono text-[#0D94FB]"
                            )}
                          />
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
                          formatAmountCell(rawVal, col, row)
                        ) : rawVal != null && rawVal !== "" ? (
                          String(rawVal)
                        ) : (
                          <span className="text-text-disabled font-mono">—</span>
                        )}
                      </td>
                    )
                  })}

                  {/* Actions Column */}
                  <td className="py-2 px-3 text-right sticky right-0 z-10 bg-surface-1/90 backdrop-blur shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="default"
                          disabled={isSaving}
                          onClick={() => handleSaveRow(globalIdx)}
                          className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-2xs"
                          title="Save changes to CSV"
                        >
                          {isSaving ? (
                            <RefreshCwIcon className="size-3 animate-spin mr-1" />
                          ) : (
                            <CheckIcon className="size-3 mr-1" />
                          )}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isSaving}
                          onClick={handleCancelEdit}
                          className="h-6 px-1.5 text-[10px] text-destructive hover:bg-destructive/10"
                          title="Discard changes"
                        >
                          <XIcon className="size-3 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleStartEdit(globalIdx, row)}
                        className="h-6 px-2 text-[10px] text-[#0D94FB] bg-[#0D94FB]/10 hover:bg-[#0D94FB]/20 font-semibold transition-all shadow-2xs"
                        title="Edit all fields in this row"
                      >
                        <Edit2Icon className="size-2.5 mr-1" />
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination & Status Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-1 text-xs text-text-muted border-t border-border/40 pt-2 shrink-0">
        <div className="flex items-center gap-3">
          <span>
            Showing <span className="font-semibold text-text-primary font-mono">{totalRecords > 0 ? startIndex + 1 : 0}–{endIndex}</span> of{" "}
            <span className="font-semibold text-text-primary font-mono">{data.total_rows || totalRecords}</span> records
          </span>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-muted">Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="h-7 text-xs rounded-md border border-border bg-surface-2 px-2 py-0.5 font-medium text-text-primary focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center">
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    disabled={validPage <= 1}
                    onClick={() => validPage > 1 && setCurrentPage(validPage - 1)}
                    className={validPage <= 1 ? "pointer-events-none opacity-40" : ""}
                  />
                </PaginationItem>

                {renderPaginationItems()}

                <PaginationItem>
                  <PaginationNext
                    disabled={validPage >= totalPages}
                    onClick={() => validPage < totalPages && setCurrentPage(validPage + 1)}
                    className={validPage >= totalPages ? "pointer-events-none opacity-40" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
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
    reconciliationStatus, error, reconcile, updateRow, loadData,
  } = useReconciliationStore()

  const lastMtimeRef = React.useRef<number>(0)

  useEffect(() => {
    setMounted(true)
    if (typeof loadData === "function") {
      loadData()
    }

    // Initialize baseline mtime
    fetchDataStatus()
      .then((res) => {
        if (res && res.last_modified) {
          lastMtimeRef.current = res.last_modified
        }
      })
      .catch(() => {})

    const handleAutoRefresh = () => {
      if (typeof loadData === "function") {
        loadData()
      }
      // Update baseline mtime on manual or event refresh
      fetchDataStatus()
        .then((res) => {
          if (res && res.last_modified) {
            lastMtimeRef.current = res.last_modified
          }
        })
        .catch(() => {})
    }

    window.addEventListener("pennywise:data_refresh", handleAutoRefresh)
    window.addEventListener("pennywise:action", handleAutoRefresh)
    window.addEventListener("focus", handleAutoRefresh)

    // Polling interval (every 2.5s) to detect background / external MCP file changes automatically
    const pollTimer = setInterval(async () => {
      try {
        const res = await fetchDataStatus()
        if (res && res.last_modified) {
          if (lastMtimeRef.current > 0 && res.last_modified > lastMtimeRef.current) {
            lastMtimeRef.current = res.last_modified
            if (typeof loadData === "function") {
              await loadData()
            }
          } else if (lastMtimeRef.current === 0) {
            lastMtimeRef.current = res.last_modified
          }
        }
      } catch {}
    }, 2500)

    return () => {
      clearInterval(pollTimer)
      window.removeEventListener("pennywise:data_refresh", handleAutoRefresh)
      window.removeEventListener("pennywise:action", handleAutoRefresh)
      window.removeEventListener("focus", handleAutoRefresh)
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
                      onUpdateRow={(i, id, rowData) => updateRow("invoice", i, id, rowData)}
                    />
                  </TabsContent>
                  <TabsContent value="razorpay" className="m-0 focus-visible:outline-none">
                    <EditableTable
                      data={displayData.razorpay}
                      fileType="razorpay"
                      onUpdateRow={(i, id, rowData) => updateRow("razorpay", i, id, rowData)}
                    />
                  </TabsContent>
                  <TabsContent value="bank" className="m-0 focus-visible:outline-none">
                    <EditableTable
                      data={displayData.bank}
                      fileType="bank"
                      onUpdateRow={(i, id, rowData) => updateRow("bank", i, id, rowData)}
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
