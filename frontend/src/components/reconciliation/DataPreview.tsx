"use client"

import React, { useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { FilePreviewData } from "@/lib/reconciliation-types"
import {
  FileTextIcon,
  FileSpreadsheetIcon,
  Edit2Icon,
  CheckIcon,
  XIcon,
  SparklesIcon,
  LayersIcon,
  EyeIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { toast } from "@/hooks/use-toast"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

interface PreviewTableProps {
  data: FilePreviewData | null
  fileType: "invoice" | "razorpay" | "bank"
  isStandardized: boolean
  onUpdateRow: (
    rowIndex: number,
    rowId: string | number | null,
    updatedData: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>
}

function PreviewTable({
  data,
  fileType,
  isStandardized,
  onUpdateRow,
}: PreviewTableProps) {
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null)
  const [editRowData, setEditRowData] = useState<Record<string, any>>({})
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(20)

  // Reset pagination when data or fileType changes
  React.useEffect(() => {
    setCurrentPage(1)
    setEditingRowIndex(null)
    setEditRowData({})
  }, [fileType, data?.preview?.length])

  if (!data || !data.preview || data.preview.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-1 p-6 text-center text-text-muted">
        <FileSpreadsheetIcon className="mb-2 size-8 text-text-disabled" />
        <p className="text-sm font-medium">No data preview available</p>
        <p className="text-xs text-text-disabled">Upload a CSV file to inspect columns and sample rows.</p>
      </div>
    )
  }

  const columns = data.columns || Object.keys(data.preview[0] || {})
  const totalRecords = data.preview.length
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize))
  const validPage = Math.min(currentPage, totalPages)
  const startIndex = (validPage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, totalRecords)
  const currentRows = data.preview.slice(startIndex, endIndex)

  const handleStartEdit = (globalIndex: number, row: Record<string, any>) => {
    setEditingRowIndex(globalIndex)
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

  const handleSaveRow = async (globalIndex: number) => {
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

    const result = await onUpdateRow(globalIndex, rowId, editRowData)
    setIsSaving(false)

    if (result.success) {
      toast({
        title: "Row Updated",
        description: `Row #${globalIndex + 1} updated and saved to ${fileType}_standardized.csv`,
        variant: "success",
      })
      setEditingRowIndex(null)
      setEditRowData({})
    } else {
      toast({
        title: "Update Failed",
        description: result.error || "Failed to update row.",
        variant: "destructive",
      })
    }
  }

  // Generate pagination range
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
    <div className="flex flex-col flex-1 min-h-0 space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary">
            {data.filename || `${fileType}.csv`}
          </span>
          <Badge variant="outline" className="text-[11px] font-mono">
            {data.total_rows || totalRecords} total rows
          </Badge>
          {isStandardized && (
            <Badge variant="default" className="bg-primary/10 text-primary border-primary/20 text-[10px]">
              <SparklesIcon className="mr-1 size-3" /> Standardized Schema
            </Badge>
          )}
        </div>
        <span className="text-xs text-text-muted">
          Showing <span className="font-mono font-medium text-text-primary">{startIndex + 1}–{endIndex}</span> of{" "}
          <span className="font-mono font-medium text-text-primary">{data.total_rows || totalRecords}</span> records
        </span>
      </div>

      <div className="flex-1 min-h-[380px] max-h-[calc(100vh-240px)] overflow-auto rounded-xl border border-border bg-background shadow-2xs relative">
        <Table>
          <TableHeader className="sticky top-0 bg-surface-2/95 backdrop-blur z-10 shadow-2xs">
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="w-12 text-center text-xs font-semibold text-text-primary bg-surface-2">
                #
              </TableHead>
              {columns.map((col) => (
                <TableHead
                  key={col}
                  className="text-xs font-semibold text-text-primary whitespace-nowrap bg-surface-2"
                >
                  {col}
                </TableHead>
              ))}
              <TableHead className="w-28 text-right text-xs font-semibold text-text-primary bg-surface-2 sticky right-0 z-20 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentRows.map((row, localIdx) => {
              const globalIdx = startIndex + localIdx
              const isEditing = editingRowIndex === globalIdx

              return (
                <TableRow
                  key={globalIdx}
                  className={
                    isEditing
                      ? "bg-primary/5 hover:bg-primary/10 border-b-2 border-b-primary/40"
                      : localIdx % 2 === 1
                      ? "bg-surface-1/40 hover:bg-surface-2/50"
                      : "hover:bg-surface-2/50"
                  }
                >
                  <TableCell className="text-center font-mono text-xs text-text-disabled">
                    {globalIdx + 1}
                  </TableCell>

                  {columns.map((col) => {
                    const rawVal = row[col]
                    const isAmountCol =
                      col.includes("amount") ||
                      col.includes("total") ||
                      col.includes("credit") ||
                      col.includes("debit") ||
                      col.includes("balance")

                    if (isEditing) {
                      const currentVal = editRowData[col] ?? rawVal ?? ""
                      return (
                        <TableCell key={col} className="py-1 px-2 min-w-[130px]">
                          <Input
                            value={currentVal}
                            disabled={isSaving}
                            onChange={(e) => handleCellChange(col, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRow(globalIdx)
                              if (e.key === "Escape") handleCancelEdit()
                            }}
                            className="h-7 text-xs px-2 w-full bg-background border-border/80 focus-visible:ring-1 focus-visible:ring-primary"
                          />
                        </TableCell>
                      )
                    }

                    return (
                      <TableCell
                        key={col}
                        className={`text-xs whitespace-nowrap ${
                          isAmountCol ? "font-mono font-medium text-text-primary" : "text-text-secondary"
                        }`}
                      >
                        <span
                          className={
                            col.includes("standardized")
                              ? "rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary"
                              : ""
                          }
                        >
                          {rawVal !== null && rawVal !== undefined
                            ? String(rawVal)
                            : "—"}
                        </span>
                      </TableCell>
                    )
                  })}

                  <TableCell className="text-right sticky right-0 z-10 bg-background/90 backdrop-blur shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.05)]">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="default"
                          disabled={isSaving}
                          onClick={() => handleSaveRow(globalIdx)}
                          className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-2xs"
                          title="Save change"
                        >
                          <CheckIcon className="size-3 mr-1" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isSaving}
                          onClick={handleCancelEdit}
                          className="h-6 px-1.5 text-[10px] text-destructive hover:bg-destructive/10"
                          title="Cancel"
                        >
                          <XIcon className="size-3 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px] text-text-muted hover:text-primary hover:bg-primary/10"
                        onClick={() => handleStartEdit(globalIdx, row)}
                        title="Edit this row"
                      >
                        <Edit2Icon className="mr-1 size-3" />
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-1 text-xs text-text-muted border-t border-border/40 pt-2 shrink-0">
        <div className="flex items-center gap-3">
          <span>
            Page <span className="font-semibold text-text-primary font-mono">{validPage}</span> of{" "}
            <span className="font-semibold text-text-primary font-mono">{totalPages}</span>
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

export function DataPreview() {
  const {
    previewData,
    standardizedData,
    uploadStatus,
    standardizationStatus,
    updateRow,
    loadData,
  } = useReconciliationStore()

  React.useEffect(() => {
    const handleRefresh = () => {
      if (typeof loadData === "function") {
        loadData()
      }
    }
    window.addEventListener("pennywise:data_refresh", handleRefresh)
    window.addEventListener("pennywise:action", handleRefresh)
    return () => {
      window.removeEventListener("pennywise:data_refresh", handleRefresh)
      window.removeEventListener("pennywise:action", handleRefresh)
    }
  }, [loadData])

  if (uploadStatus === "idle" && standardizationStatus === "idle") {
    return null
  }

  const isStandardized = standardizationStatus === "completed"
  const activeInvoice = isStandardized && standardizedData.invoice ? standardizedData.invoice : previewData.invoice
  const activeRazorpay = isStandardized && standardizedData.razorpay ? standardizedData.razorpay : previewData.razorpay
  const activeBank = isStandardized && standardizedData.bank ? standardizedData.bank : previewData.bank

  return (
    <Card className="border-border shadow-xs">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <EyeIcon className="size-4" />
            </div>
            <CardTitle className="text-lg font-semibold text-text-primary">
              Source Data Inspection & Human Review
            </CardTitle>
          </div>
          <CardDescription className="mt-1 text-xs text-text-muted">
            Inspect raw inputs or LLM-standardized records. Click "Edit" on any row to calibrate entity names before reconciliation.
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          {isStandardized ? (
            <Badge variant="default" className="bg-success text-white text-xs py-1 px-2.5">
              <ShieldCheckIcon className="mr-1 size-3.5" />
              LLM Standardized
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs py-1 px-2.5">
              <LayersIcon className="mr-1 size-3.5" />
              Raw CSV Preview
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        <Tabs defaultValue="invoices" className="w-full">
          <TabsList className="mb-4 bg-surface-2 p-1">
            <TabsTrigger value="invoices" className="gap-2 text-xs font-medium">
              <FileTextIcon className="size-3.5" />
              Invoices
              {activeInvoice?.total_rows ? (
                <span className="rounded-full bg-surface-3 px-1.5 py-0.2 font-mono text-[10px] text-text-muted">
                  {activeInvoice.total_rows}
                </span>
              ) : null}
            </TabsTrigger>

            <TabsTrigger value="razorpay" className="gap-2 text-xs font-medium">
              <FileSpreadsheetIcon className="size-3.5" />
              Razorpay Settlements
              {activeRazorpay?.total_rows ? (
                <span className="rounded-full bg-surface-3 px-1.5 py-0.2 font-mono text-[10px] text-text-muted">
                  {activeRazorpay.total_rows}
                </span>
              ) : null}
            </TabsTrigger>

            <TabsTrigger value="bank" className="gap-2 text-xs font-medium">
              <FileSpreadsheetIcon className="size-3.5" />
              Bank Statements
              {activeBank?.total_rows ? (
                <span className="rounded-full bg-surface-3 px-1.5 py-0.2 font-mono text-[10px] text-text-muted">
                  {activeBank.total_rows}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="invoices" className="outline-none">
            <PreviewTable
              data={activeInvoice}
              fileType="invoice"
              isStandardized={isStandardized}
              onUpdateRow={(rowIdx, rowId, rowData) => updateRow("invoice", rowIdx, rowId, rowData)}
            />
          </TabsContent>

          <TabsContent value="razorpay" className="outline-none">
            <PreviewTable
              data={activeRazorpay}
              fileType="razorpay"
              isStandardized={isStandardized}
              onUpdateRow={(rowIdx, rowId, rowData) => updateRow("razorpay", rowIdx, rowId, rowData)}
            />
          </TabsContent>

          <TabsContent value="bank" className="outline-none">
            <PreviewTable
              data={activeBank}
              fileType="bank"
              isStandardized={isStandardized}
              onUpdateRow={(rowIdx, rowId, rowData) => updateRow("bank", rowIdx, rowId, rowData)}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
