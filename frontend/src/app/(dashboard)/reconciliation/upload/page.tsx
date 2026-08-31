"use client"

import React, { useRef } from "react"
import { useRouter } from "next/navigation"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FileTextIcon, UploadCloudIcon, CheckCircle2Icon, FileSpreadsheetIcon,
  AlertCircleIcon, RotateCcwIcon, RefreshCwIcon, SparklesIcon,
} from "lucide-react"

// ── File drop zone ──────────────────────────────────────────────────────────
interface DropZoneProps {
  label: string
  sublabel: string
  icon: React.ReactNode
  file: File | null
  previewFilename?: string
  totalRows?: number
  onSelect: (f: File) => void
}

function DropZone({ label, sublabel, icon, file, previewFilename, totalRows, onSelect }: DropZoneProps) {
  const ref = useRef<HTMLInputElement>(null)
  const isReady = Boolean(file || previewFilename)
  const displayName = file?.name || previewFilename || ""

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation()
        const f = e.dataTransfer.files?.[0]
        if (f?.name.toLowerCase().endsWith(".csv")) onSelect(f)
      }}
      onClick={() => ref.current?.click()}
      className={`group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all cursor-pointer select-none min-h-[180px] ${
        isReady
          ? "border-primary bg-primary/5"
          : "border-border/80 bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
      }`}
    >
      <input ref={ref} type="file" accept=".csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelect(f) }} />

      <div className={`mb-3 flex size-12 items-center justify-center rounded-full transition-transform group-hover:scale-105 ${
        isReady
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
      }`}>
        {isReady ? <CheckCircle2Icon className="size-6" /> : icon}
      </div>

      <div className="flex items-center gap-1.5 font-semibold text-sm">
        {label}
        {isReady && (
          <Badge className="bg-emerald-500 text-white text-[10px] h-4 px-1.5">Ready</Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>

      {isReady ? (
        <div className="mt-3 w-full flex items-center justify-between rounded-lg bg-background px-3 py-2 text-xs border border-primary/20">
          <div className="flex items-center gap-2 truncate">
            <FileSpreadsheetIcon className="size-4 shrink-0 text-primary" />
            <span className="truncate font-medium">{displayName}</span>
          </div>
          {file ? (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
          ) : (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">Sample CSV</span>
          )}
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm"
          className="mt-3 w-full text-xs font-medium hover:border-primary hover:text-primary"
          onClick={(e) => { e.stopPropagation(); ref.current?.click() }}>
          <UploadCloudIcon className="mr-1.5 size-3.5" /> Choose CSV
        </Button>
      )}

      {isReady && totalRows !== undefined && totalRows > 0 && (
        <span className="mt-2 text-[11px] font-medium text-emerald-600">{totalRows} records detected</span>
      )}
    </div>
  )
}

// ── Main Upload Page ─────────────────────────────────────────────────────────
export default function UploadPage() {
  const router = useRouter()
  const {
    uploadedFiles, uploadStatus, previewData, error,
    baseCurrency, setBaseCurrency,
    setFile, uploadAndPreview, loadSampleBenchmarkData, resetAll,
  } = useReconciliationStore()

  const hasFreshFiles = Boolean(uploadedFiles.invoice && uploadedFiles.razorpay && uploadedFiles.bank)
  const hasExistingData = Boolean(
    (uploadedFiles.invoice || (previewData.invoice?.preview?.length || previewData.invoice?.filename)) &&
    (uploadedFiles.razorpay || (previewData.razorpay?.preview?.length || previewData.razorpay?.filename)) &&
    (uploadedFiles.bank || (previewData.bank?.preview?.length || previewData.bank?.filename))
  )
  const allSelected = hasFreshFiles || hasExistingData
  const isUploading = uploadStatus === "uploading"

  const handleUploadAndContinue = async () => {
    if (uploadedFiles.invoice && uploadedFiles.razorpay && uploadedFiles.bank) {
      await uploadAndPreview()
    } else if (!hasExistingData) {
      await loadSampleBenchmarkData()
    }
    router.push("/reconciliation/standardize")
  }

  const handleLoadSampleBenchmark = async () => {
    await loadSampleBenchmarkData()
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Upload Source Files</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your Invoice, Razorpay Settlement, and Bank Statement CSVs to begin the reconciliation pipeline.
          </p>
        </div>

        {/* 1-Click Sample Benchmark */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleLoadSampleBenchmark}
          disabled={isUploading}
          className="shrink-0 h-9 border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary font-medium text-xs shadow-sm"
        >
          <SparklesIcon className="mr-1.5 size-3.5 text-primary" />
          Load Benchmark Sample (200 records)
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* File upload card */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <UploadCloudIcon className="size-4" />
              </div>
              <CardTitle className="text-base font-semibold">Source CSV Files</CardTitle>
            </div>
            <CardDescription className="mt-1 text-xs">
              All three files are required. Drag-and-drop or click to browse.
            </CardDescription>
          </div>

          {/* Right Header Actions: Base Currency Dropdown + Reset */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                Base Currency:
              </span>
              <Select
                value={baseCurrency || "INR"}
                onValueChange={(val) => setBaseCurrency(val || "INR")}
              >
                <SelectTrigger id="base-currency" className="h-8 w-36 text-xs bg-background">
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INR">INR (₹)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                  <SelectItem value="GBP">GBP (£)</SelectItem>
                  <SelectItem value="SGD">SGD (S$)</SelectItem>
                  <SelectItem value="AED">AED (د.إ)</SelectItem>
                  <SelectItem value="CAD">CAD (C$)</SelectItem>
                  <SelectItem value="AUD">AUD (A$)</SelectItem>
                  <SelectItem value="JPY">JPY (¥)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {allSelected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetAll}
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <RotateCcwIcon className="mr-1.5 size-3.5" /> Reset
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <DropZone
              label="Invoices"
              sublabel="Accounts Receivable / Billing Export"
              icon={<FileTextIcon className="size-6" />}
              file={uploadedFiles.invoice}
              previewFilename={previewData.invoice?.filename || (previewData.invoice?.preview?.length ? "invoices.csv" : undefined)}
              totalRows={previewData.invoice?.total_rows || previewData.invoice?.preview?.length}
              onSelect={(f) => setFile("invoice", f)}
            />
            <DropZone
              label="Razorpay"
              sublabel="Payment Gateway Settlements"
              icon={<FileSpreadsheetIcon className="size-6" />}
              file={uploadedFiles.razorpay}
              previewFilename={previewData.razorpay?.filename || (previewData.razorpay?.preview?.length ? "razorpay_settlements.csv" : undefined)}
              totalRows={previewData.razorpay?.total_rows || previewData.razorpay?.preview?.length}
              onSelect={(f) => setFile("razorpay", f)}
            />
            <DropZone
              label="Bank Statement"
              sublabel="Core Banking Feed / Statement CSV"
              icon={<FileSpreadsheetIcon className="size-6" />}
              file={uploadedFiles.bank}
              previewFilename={previewData.bank?.filename || (previewData.bank?.preview?.length ? "bank.csv" : undefined)}
              totalRows={previewData.bank?.total_rows || previewData.bank?.preview?.length}
              onSelect={(f) => setFile("bank", f)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Primary action */}
      <div className="flex justify-end">
        <Button
          size="lg"
          disabled={!allSelected || isUploading}
          onClick={handleUploadAndContinue}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md min-w-[200px]"
        >
          {isUploading ? (
            <><RefreshCwIcon className="mr-2 size-4 animate-spin" /> Uploading...</>
          ) : hasFreshFiles ? (
            <><UploadCloudIcon className="mr-2 size-4" /> Upload &amp; Continue</>
          ) : hasExistingData ? (
            <><CheckCircle2Icon className="mr-2 size-4" /> Continue with Loaded Data</>
          ) : (
            <><UploadCloudIcon className="mr-2 size-4" /> Upload &amp; Continue</>
          )}
        </Button>
      </div>
    </div>
  )
}
