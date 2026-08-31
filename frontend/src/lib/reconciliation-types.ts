export type ProcessStatus = 'idle' | 'running' | 'completed' | 'error'
export type UploadStatus = 'idle' | 'uploading' | 'uploaded' | 'error'

export interface FilePreviewData {
  filename: string
  saved_as?: string
  saved_path?: string
  total_rows: number
  columns: string[]
  preview: Record<string, any>[]
}

export interface UploadedFilesMap {
  invoice: File | null
  razorpay: File | null
  bank: File | null
}

export interface PreviewDataMap {
  invoice: FilePreviewData | null
  razorpay: FilePreviewData | null
  bank: FilePreviewData | null
}

export interface MatchedTriplet {
  id: string
  invoice_id: string
  invoice_ids?: string[]
  razorpay_id: string
  settlement_utr?: string
  bank_ref_no: string
  amount: number
  currency?: string
  vendor?: string
  date?: string
  status: 'Matched' | 'Exception'
  match_type?: '1:1 Exact' | '1:1 Fuzzy' | 'N:1 Group' | '1:N Split' | '1:N Subset-Sum' | 'Manual' | string
  confidence?: number
}

export interface ReconciliationException {
  id: string
  type: 'Invoice' | 'Razorpay' | 'Bank' | string
  source_id: string
  vendor: string
  amount: number
  currency?: string
  date: string
  reason: string
  severity?: 'High' | 'Medium' | 'Low' | 'Resolved' | string
  status?: 'Open' | 'Resolved' | string
  status_type?: 'exception' | 'unallocated_cash' | 'resolved' | string
  resolution_note?: string
  resolved_at?: string
}

export interface ReconciliationResults {
  matchRate: number
  invoiceMatchRate?: number
  recordCoverageRate?: number
  record_coverage_rate?: number
  matchedCount: number
  matchedInvoicesCount?: number
  unallocatedCount?: number
  auditExceptionCount?: number
  resolvedCount?: number
  matchedTripletsCount?: number
  exceptionCount: number
  totalCount: number
  triplets: MatchedTriplet[]
  exceptions: ReconciliationException[]
  totalInvoiceAmount?: number
  totalInvoiceSubtotal?: number
  totalInvoiceTax?: number
  totalSettledAmount?: number
  totalBankCredit?: number
  totalGrossSettlement?: number
  totalFeeAmount?: number
  totalUncollectedAmount?: number
  totalResolvedAmount?: number
  discrepancyAmount?: number
}

export interface StandardizationMetrics {
  durationSeconds: number
  cleanedVendorsCount: number
  standardizedDatesCount: number
  convertedCurrenciesCount: number
}
