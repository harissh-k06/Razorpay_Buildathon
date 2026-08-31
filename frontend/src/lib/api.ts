import {
  FilePreviewData,
  PreviewDataMap,
  ReconciliationResults,
} from './reconciliation-types'

export function getApiBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) {
    const url = process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/+$/, '')
    if (url) return url
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    const isLocalOrLan =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.local') ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host)

    if (isLocalOrLan) {
      return `http://${host}:8000`
    }
    return 'https://razorpay-buildathon-nmh1.onrender.com'
  }
  return 'http://localhost:8000'
}

export const API_BASE_URL = getApiBaseUrl()

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    const msg = errorData.detail || errorData.error || errorData.message || `HTTP ${res.status}`
    throw new ApiError(msg, res.status)
  }
  return res.json() as Promise<T>
}

export async function checkBackendHealth(): Promise<{
  status: string
  service: string
  version: string
}> {
  const res = await fetch(`${getApiBaseUrl()}/api/health`)
  return handleResponse(res)
}

export interface UploadResponse {
  status: string
  message: string
  timestamp: string
  files: {
    invoice: FilePreviewData & { saved_path: string }
    razorpay: FilePreviewData & { saved_path: string }
    bank: FilePreviewData & { saved_path: string }
  }
}

export async function uploadReconciliationFiles(
  invoiceFile: File,
  razorpayFile: File,
  bankFile: File
): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('invoice', invoiceFile)
  formData.append('razorpay', razorpayFile)
  formData.append('bank', bankFile)

  const res = await fetch(`${getApiBaseUrl()}/api/upload`, {
    method: 'POST',
    body: formData,
  })
  return handleResponse<UploadResponse>(res)
}

export async function loadSampleBenchmark(): Promise<UploadResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/load-sample`, {
    method: 'POST',
  })
  return handleResponse<UploadResponse>(res)
}

export interface StandardizeResponse {
  status: string
  duration_seconds?: number
  message?: string
  base_currency?: string
  standardized_files: {
    invoice: (FilePreviewData & { saved_path: string }) | null
    razorpay: (FilePreviewData & { saved_path: string }) | null
    bank: (FilePreviewData & { saved_path: string }) | null
  }
}

export async function runStandardization(savedPaths: {
  invoice_path: string
  razorpay_path: string
  bank_path: string
  base_currency?: string
}): Promise<StandardizeResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/standardize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(savedPaths),
  })
  return handleResponse<StandardizeResponse>(res)
}

export interface ReconcileParams {
  date_tolerance_days?: number
  amount_tolerance_pct?: number
  strict_vendor_matching?: boolean
  weight_amount?: number
  weight_date?: number
  weight_vendor?: number
  rejection_threshold?: number
  allow_split?: boolean
  max_invoices_per_settlement?: number
  split_tolerance_pct?: number
}

export async function fetchReconcileParams(): Promise<{ status: string; params: ReconcileParams }> {
  const res = await fetch(`${getApiBaseUrl()}/api/reconcile-params?_t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  })
  return handleResponse<{ status: string; params: ReconcileParams }>(res)
}

export async function updateReconcileParamsApi(
  params: ReconcileParams
): Promise<{ success: boolean; params: ReconcileParams; message?: string }> {
  const res = await fetch(`${getApiBaseUrl()}/api/reconcile-params`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return handleResponse<{ success: boolean; params: ReconcileParams; message?: string }>(res)
}

export async function runReconciliation(
  params?: ReconcileParams
): Promise<ReconciliationResults> {
  const res = await fetch(`${getApiBaseUrl()}/api/reconcile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  })
  return handleResponse<ReconciliationResults>(res)
}

export async function fetchDataStatus(): Promise<{ last_modified: number }> {
  const res = await fetch(`${getApiBaseUrl()}/api/data_status?_t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  })
  return handleResponse<{ last_modified: number }>(res)
}

export async function fetchStandardizedData(): Promise<StandardizeResponse> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/standardized-data?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    })
    if (!res.ok) {
      // Fallback to underscore alias if needed
      const fallbackRes = await fetch(`${getApiBaseUrl()}/api/standardized_data?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      })
      return await handleResponse<StandardizeResponse>(fallbackRes)
    }
    return await handleResponse<StandardizeResponse>(res)
  } catch (err) {
    console.warn('Could not fetch standardized data from backend:', err)
    return {
      status: 'error',
      standardized_files: {
        invoice: null as any,
        razorpay: null as any,
        bank: null as any,
      },
    }
  }
}

export async function sendChatMessage(message: string, sessionId?: string, agenticMode?: boolean): Promise<{ response: string }> {
  const res = await fetch(`${getApiBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      session_id: sessionId || 'default',
      agentic_mode: agenticMode,
    }),
  })
  return handleResponse<{ response: string }>(res)
}

export async function fetchAgenticMode(): Promise<{ enabled: boolean }> {
  const res = await fetch(`${getApiBaseUrl()}/api/agentic-mode?_t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  })
  return handleResponse<{ enabled: boolean }>(res)
}

export interface UpdateRowPayload {
  source: 'invoice' | 'razorpay' | 'bank' | string
  rowId?: string | number | null
  rowIndex?: number | null
  updatedData: Record<string, any>
}

export interface UpdateRowResponse {
  status: string
  message: string
  source: string
  preview: FilePreviewData & { saved_path: string }
}

export async function updateStandardizedRow(
  payload: UpdateRowPayload
): Promise<UpdateRowResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/update-row`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<UpdateRowResponse>(res)
}

export async function updateAgenticMode(enabled: boolean): Promise<{ enabled: boolean }> {
  const res = await fetch(`${getApiBaseUrl()}/api/agentic-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  return handleResponse<{ enabled: boolean }>(res)
}

export interface ResolveExceptionsPayload {
  exception_ids: string[]
  mode: 'memo' | 'direct' | 'manual' | string
  resolution_note?: string
}

export interface ResolveExceptionsResponse {
  status: string
  success: boolean
  mode: string
  result?: any
  exceptions?: import('./reconciliation-types').ReconciliationException[]
  unallocatedCount?: number
  auditExceptionCount?: number
  resolvedCount?: number
  totalCount?: number
  memo_text?: string
  requires_confirmation?: boolean
  error?: string
}

export async function resolveExceptionsApi(
  payload: ResolveExceptionsPayload
): Promise<ResolveExceptionsResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/resolve-exceptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<ResolveExceptionsResponse>(res)
}

export async function fetchReconciliationResults(): Promise<import('./reconciliation-types').ReconciliationResults> {
  const res = await fetch(`${getApiBaseUrl()}/api/reconciliation-results?_t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  })
  return handleResponse<import('./reconciliation-types').ReconciliationResults>(res)
}




