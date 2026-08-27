"use client"

import React, { useRef } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useReconciliationStore } from "@/store/reconciliationStore"
import {
  FileTextIcon,
  UploadCloudIcon,
  SparklesIcon,
  TargetIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  RefreshCwIcon,
  FileSpreadsheetIcon,
  ArrowRightIcon,
  RotateCcwIcon,
} from "lucide-react"

interface FileUploadBoxProps {
  label: string
  sublabel: string
  fileKey: "invoice" | "razorpay" | "bank"
  icon: React.ReactNode
  currentFile: File | null
  totalRows?: number
  onFileSelect: (file: File) => void
}

function FileUploadBox({
  label,
  sublabel,
  fileKey,
  icon,
  currentFile,
  totalRows,
  onFileSelect,
}: FileUploadBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      if (file.name.toLowerCase().endsWith(".csv")) {
        onFileSelect(file)
      }
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0])
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center transition-all cursor-pointer select-none ${
        currentFile
          ? "border-primary bg-primary/5 shadow-xs"
          : "border-border/80 bg-surface-1 hover:border-primary/50 hover:bg-surface-2/60"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleChange}
      />

      <div
        className={`mb-3 flex size-12 items-center justify-center rounded-full transition-transform group-hover:scale-105 ${
          currentFile
            ? "bg-primary text-primary-foreground shadow-sm"
            : "bg-surface-3 text-text-secondary group-hover:bg-primary/10 group-hover:text-primary"
        }`}
      >
        {currentFile ? <CheckCircle2Icon className="size-6" /> : icon}
      </div>

      <div className="flex items-center gap-1.5 font-semibold text-text-primary">
        <span>{label}</span>
        {currentFile && (
          <Badge variant="default" className="bg-success text-white text-[10px] h-4.5 px-1.5">
            Ready
          </Badge>
        )}
      </div>

      <p className="mt-1 text-xs text-text-muted">{sublabel}</p>

      <div className="mt-3 w-full">
        {currentFile ? (
          <div className="flex items-center justify-between rounded-lg bg-background px-3 py-2 text-xs border border-primary/20 shadow-2xs">
            <div className="flex items-center gap-2 truncate pr-2">
              <FileSpreadsheetIcon className="size-4 shrink-0 text-primary" />
              <span className="truncate font-medium text-text-primary">
                {currentFile.name}
              </span>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-text-disabled">
              {(currentFile.size / 1024).toFixed(1)} KB
            </span>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full text-xs font-medium border-border/80 hover:border-primary hover:text-primary"
            onClick={(e) => {
              e.stopPropagation()
              inputRef.current?.click()
            }}
          >
            <UploadCloudIcon className="mr-1.5 size-3.5" />
            Choose CSV
          </Button>
        )}
      </div>

      {totalRows !== undefined && totalRows > 0 && (
        <span className="mt-2 text-[11px] font-medium text-success">
          ✓ {totalRows} records loaded
        </span>
      )}
    </div>
  )
}

export function FileUpload() {
  const {
    uploadedFiles,
    uploadStatus,
    standardizationStatus,
    reconciliationStatus,
    previewData,
    setFile,
    uploadAndPreview,
    standardize,
    reconcile,
    resetAll,
    error,
  } = useReconciliationStore()

  const allFilesSelected = Boolean(
    uploadedFiles.invoice && uploadedFiles.razorpay && uploadedFiles.bank
  )
  const isUploaded = uploadStatus === "uploaded"
  const isStandardized = standardizationStatus === "completed"
  const isUploading = uploadStatus === "uploading"
  const isStandardizing = standardizationStatus === "running"
  const isReconciling = reconciliationStatus === "running"

  return (
    <Card className="border-border shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UploadCloudIcon className="size-4" />
            </div>
            <CardTitle className="text-lg font-semibold text-text-primary">
              3-Way Reconciliation Data Upload
            </CardTitle>
          </div>
          <CardDescription className="mt-1 text-xs text-text-muted">
            Upload your Invoice, Razorpay Settlement, and Bank Statement CSV files to initiate AI standardization and 3-way Hungarian matching.
          </CardDescription>
        </div>

        {(isUploaded || allFilesSelected) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAll}
            className="text-xs text-text-muted hover:text-destructive hover:bg-destructive/10"
          >
            <RotateCcwIcon className="mr-1.5 size-3.5" />
            Reset Files
          </Button>
        )}
      </CardHeader>

      <CardContent className="pt-5">
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 3 Upload Boxes */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FileUploadBox
            label="Invoices"
            sublabel="Accounts Receivable / Billing Export (.csv)"
            fileKey="invoice"
            icon={<FileTextIcon className="size-6" />}
            currentFile={uploadedFiles.invoice}
            totalRows={previewData.invoice?.total_rows}
            onFileSelect={(file) => setFile("invoice", file)}
          />

          <FileUploadBox
            label="Razorpay"
            sublabel="Payment Gateway Settlements (.csv)"
            fileKey="razorpay"
            icon={<FileSpreadsheetIcon className="size-6" />}
            currentFile={uploadedFiles.razorpay}
            totalRows={previewData.razorpay?.total_rows}
            onFileSelect={(file) => setFile("razorpay", file)}
          />

          <FileUploadBox
            label="Bank Statement"
            sublabel="Core Banking Feed / Bank CSV (.csv)"
            fileKey="bank"
            icon={<FileSpreadsheetIcon className="size-6" />}
            currentFile={uploadedFiles.bank}
            totalRows={previewData.bank?.total_rows}
            onFileSelect={(file) => setFile("bank", file)}
          />
        </div>

        {/* Pipeline Step Action Buttons */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="font-semibold text-text-secondary">Pipeline Workflow:</span>
            <span className={allFilesSelected ? "text-primary font-medium" : ""}>1. Select CSVs</span>
            <ArrowRightIcon className="size-3 text-text-disabled" />
            <span className={isUploaded ? "text-primary font-medium" : ""}>2. Upload & Preview</span>
            <ArrowRightIcon className="size-3 text-text-disabled" />
            <span className={isStandardized ? "text-primary font-medium" : ""}>3. AI Standardize</span>
            <ArrowRightIcon className="size-3 text-text-disabled" />
            <span className={reconciliationStatus === "completed" ? "text-primary font-medium" : ""}>4. Reconcile</span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Step 1: Upload & Preview */}
            <Button
              variant={isUploaded ? "outline" : "default"}
              size="default"
              disabled={!allFilesSelected || isUploading}
              onClick={uploadAndPreview}
              className={`font-medium transition-all shadow-xs ${
                !isUploaded && allFilesSelected
                  ? "bg-primary hover:bg-primary-dark text-white"
                  : ""
              }`}
            >
              {isUploading ? (
                <>
                  <RefreshCwIcon className="mr-2 size-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <UploadCloudIcon className="mr-2 size-4" />
                  {isUploaded ? "Re-upload CSVs" : "Upload & Preview"}
                </>
              )}
            </Button>

            {/* Step 2: Standardize */}
            <Button
              variant={isStandardized ? "outline" : "default"}
              size="default"
              disabled={!isUploaded || isStandardizing}
              onClick={() => standardize()}
              className={`font-medium transition-all shadow-xs ${
                isUploaded && !isStandardized
                  ? "bg-primary hover:bg-primary-dark text-white"
                  : ""
              }`}
            >
              {isStandardizing ? (
                <>
                  <RefreshCwIcon className="mr-2 size-4 animate-spin" />
                  Standardizing LLM...
                </>
              ) : (
                <>
                  <SparklesIcon className="mr-2 size-4 text-amber-300" />
                  {isStandardized ? "Re-standardize" : "🤖 Standardize (LLM)"}
                </>
              )}
            </Button>

            {/* Step 3: Reconcile */}
            <Button
              variant="default"
              size="default"
              disabled={(!isUploaded && !isStandardized) || isReconciling}
              onClick={reconcile}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-xs"
            >
              {isReconciling ? (
                <>
                  <RefreshCwIcon className="mr-2 size-4 animate-spin" />
                  Matching Algorithms...
                </>
              ) : (
                <>
                  <TargetIcon className="mr-2 size-4" />
                  🎯 Reconcile (Hungarian)
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
