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

interface PreviewTableProps {
  data: FilePreviewData | null
  fileType: "invoice" | "razorpay" | "bank"
  isStandardized: boolean
  onEditVendor: (rowIndex: number, newVendor: string) => void
}

function PreviewTable({
  data,
  fileType,
  isStandardized,
  onEditVendor,
}: PreviewTableProps) {
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const [editValue, setEditValue] = useState("")

  if (!data || !data.preview || data.preview.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-1 p-6 text-center text-text-muted">
        <FileSpreadsheetIcon className="mb-2 size-8 text-text-disabled" />
        <p className="text-sm font-medium">No data preview available</p>
        <p className="text-xs text-text-disabled">Upload a CSV file to inspect columns and sample rows.</p>
      </div>
    )
  }

  const columns = data.columns || Object.keys(data.preview[0] || {})

  const handleStartEdit = (rowIndex: number, currentVendor: string) => {
    setEditingRow(rowIndex)
    setEditValue(currentVendor)
  }

  const handleSaveEdit = (rowIndex: number) => {
    if (editValue.trim()) {
      onEditVendor(rowIndex, editValue.trim())
    }
    setEditingRow(null)
  }

  const handleCancelEdit = () => {
    setEditingRow(null)
    setEditValue("")
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary">
            {data.filename}
          </span>
          <Badge variant="outline" className="text-[11px] font-mono">
            {data.total_rows} total rows
          </Badge>
          {isStandardized && (
            <Badge variant="default" className="bg-primary/10 text-primary border-primary/20 text-[10px]">
              <SparklesIcon className="mr-1 size-3" /> Standardized Schema
            </Badge>
          )}
        </div>
        <span className="text-xs text-text-muted">
          Showing top {data.preview.length} sample rows
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-background shadow-2xs">
        <Table>
          <TableHeader className="bg-surface-2/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 text-center text-xs font-semibold text-text-primary">
                #
              </TableHead>
              {columns.map((col) => (
                <TableHead
                  key={col}
                  className="text-xs font-semibold text-text-primary whitespace-nowrap"
                >
                  {col}
                </TableHead>
              ))}
              <TableHead className="w-24 text-right text-xs font-semibold text-text-primary">
                Human Review
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.preview.map((row, idx) => {
              const vendorField =
                row.vendor_standardized ||
                row.vendor_name ||
                row.vendor ||
                row.description ||
                ""

              const isEditing = editingRow === idx

              return (
                <TableRow
                  key={idx}
                  className={
                    idx % 2 === 1
                      ? "bg-surface-1/40 hover:bg-surface-2/50"
                      : "hover:bg-surface-2/50"
                  }
                >
                  <TableCell className="text-center font-mono text-xs text-text-disabled">
                    {idx + 1}
                  </TableCell>

                  {columns.map((col) => {
                    const value = row[col]
                    const isVendorCol =
                      col.includes("vendor") || col.includes("description")
                    const isAmountCol =
                      col.includes("amount") ||
                      col.includes("total") ||
                      col.includes("credit") ||
                      col.includes("debit") ||
                      col.includes("balance")

                    return (
                      <TableCell
                        key={col}
                        className={`text-xs whitespace-nowrap ${
                          isAmountCol ? "font-mono font-medium text-text-primary" : "text-text-secondary"
                        }`}
                      >
                        {isVendorCol && isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="h-7 text-xs py-0 px-2 w-44"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEdit(idx)
                                if (e.key === "Escape") handleCancelEdit()
                              }}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6 text-success hover:bg-success/10"
                              onClick={() => handleSaveEdit(idx)}
                              title="Save change"
                            >
                              <CheckIcon className="size-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6 text-destructive hover:bg-destructive/10"
                              onClick={handleCancelEdit}
                              title="Cancel"
                            >
                              <XIcon className="size-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span
                            className={
                              col.includes("standardized")
                                ? "rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary"
                                : ""
                            }
                          >
                            {value !== null && value !== undefined
                              ? String(value)
                              : "—"}
                          </span>
                        )}
                      </TableCell>
                    )
                  })}

                  <TableCell className="text-right">
                    {!isEditing ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px] text-text-muted hover:text-primary hover:bg-primary/10"
                        onClick={() => handleStartEdit(idx, String(vendorField))}
                        title="Edit vendor name inline"
                      >
                        <Edit2Icon className="mr-1 size-3" />
                        Edit
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
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
    updateVendorName,
  } = useReconciliationStore()

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
              onEditVendor={(rowIdx, val) => updateVendorName("invoice", rowIdx, val)}
            />
          </TabsContent>

          <TabsContent value="razorpay" className="outline-none">
            <PreviewTable
              data={activeRazorpay}
              fileType="razorpay"
              isStandardized={isStandardized}
              onEditVendor={(rowIdx, val) => updateVendorName("razorpay", rowIdx, val)}
            />
          </TabsContent>

          <TabsContent value="bank" className="outline-none">
            <PreviewTable
              data={activeBank}
              fileType="bank"
              isStandardized={isStandardized}
              onEditVendor={(rowIdx, val) => updateVendorName("bank", rowIdx, val)}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
