"use client"

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  FilePreviewData,
  PreviewDataMap,
  ProcessStatus,
  ReconciliationResults,
  UploadedFilesMap,
  UploadStatus,
} from '@/lib/reconciliation-types'
import {
  uploadReconciliationFiles,
  runStandardization as apiStandardize,
  runReconciliation as apiReconcile,
  fetchStandardizedData,
  fetchReconciliationResults,
  fetchAgenticMode,
  updateAgenticMode,
  updateStandardizedRow,
  resolveExceptionsApi,
  ReconcileParams,
} from '@/lib/api'

export interface ReconciliationState {
  // State
  uploadedFiles: UploadedFilesMap
  savedPaths: { invoice: string | null; razorpay: string | null; bank: string | null }
  uploadStatus: UploadStatus
  standardizationStatus: ProcessStatus
  reconciliationStatus: ProcessStatus
  previewData: PreviewDataMap
  standardizedData: PreviewDataMap
  results: ReconciliationResults | null
  activeProgressMessage: string
  error: string | null
  standardizationDuration: number | null
  reconcileParams: ReconcileParams
  agenticMode: boolean
  baseCurrency: string

  // Actions
  setBaseCurrency: (currency: string) => void
  setFile: (key: keyof UploadedFilesMap, file: File | null) => void
  uploadAndPreview: () => Promise<void>
  standardize: (baseCurrency?: string) => Promise<void>
  reconcile: () => Promise<void>
  loadData: () => Promise<void>
  updateVendorName: (fileType: 'invoice' | 'razorpay' | 'bank', rowIndex: number, newVendor: string) => void
  updateRow: (
    fileType: 'invoice' | 'razorpay' | 'bank',
    rowIndex: number,
    rowId: string | number | null,
    updatedData: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>
  resolveExceptions: (
    exceptionIds: string[],
    mode: 'memo' | 'direct' | 'manual',
    resolutionNote?: string
  ) => Promise<{ success: boolean; error?: string; memo_text?: string; requires_confirmation?: boolean; result?: any }>
  setReconcileParams: (params: Partial<ReconcileParams>) => void
  setAgenticMode: (enabled: boolean) => Promise<void>
  resetAll: () => void
}

const DEFAULT_RECONCILE_PARAMS: ReconcileParams = {
  date_tolerance_days: 7,
  amount_tolerance_pct: 5.0,
  strict_vendor_matching: false,
  weight_amount: 70,
  weight_date: 30,
  weight_vendor: 0,
  rejection_threshold: 0.40,
  allow_split: true,
  max_invoices_per_settlement: 5,
  split_tolerance_pct: 20.0,
}

const initialState: Omit<
  ReconciliationState,
  | 'setBaseCurrency'
  | 'setFile'
  | 'uploadAndPreview'
  | 'standardize'
  | 'reconcile'
  | 'loadData'
  | 'updateVendorName'
  | 'updateRow'
  | 'resolveExceptions'
  | 'setReconcileParams'
  | 'setAgenticMode'
  | 'resetAll'
> = {
  uploadedFiles: { invoice: null, razorpay: null, bank: null },
  savedPaths: { invoice: null, razorpay: null, bank: null },
  uploadStatus: 'idle',
  standardizationStatus: 'idle',
  reconciliationStatus: 'idle',
  previewData: { invoice: null, razorpay: null, bank: null },
  standardizedData: { invoice: null, razorpay: null, bank: null },
  results: null,
  activeProgressMessage: '',
  error: null,
  standardizationDuration: null,
  reconcileParams: DEFAULT_RECONCILE_PARAMS,
  agenticMode: false,
  baseCurrency: 'INR',
}

const STORAGE_KEY = 'reconciliation_session_state'

function loadSessionState(): Partial<ReconciliationState> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return {
      savedPaths: parsed.savedPaths || initialState.savedPaths,
      uploadStatus: parsed.uploadStatus || 'idle',
      standardizationStatus: parsed.standardizationStatus || 'idle',
      reconciliationStatus: parsed.reconciliationStatus || 'idle',
      previewData: parsed.previewData || initialState.previewData,
      standardizedData: parsed.standardizedData || initialState.standardizedData,
      results: parsed.results || null,
      standardizationDuration: parsed.standardizationDuration ?? null,
      reconcileParams: parsed.reconcileParams || DEFAULT_RECONCILE_PARAMS,
      baseCurrency: parsed.baseCurrency || 'INR',
    }
  } catch {
    return {}
  }
}

function saveSessionState(current: ReconciliationState) {
  if (typeof window === 'undefined') return
  try {
    const toSave = {
      savedPaths: current.savedPaths,
      uploadStatus: current.uploadStatus,
      standardizationStatus: current.standardizationStatus,
      reconciliationStatus: current.reconciliationStatus,
      previewData: current.previewData,
      standardizedData: current.standardizedData,
      results: current.results,
      standardizationDuration: current.standardizationDuration,
      reconcileParams: current.reconcileParams,
      baseCurrency: current.baseCurrency,
    }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    if (current.savedPaths.invoice) {
      window.sessionStorage.setItem('filePaths', JSON.stringify(current.savedPaths))
    }
    if (current.standardizedData.invoice) {
      window.sessionStorage.setItem('standardizedData', JSON.stringify(current.standardizedData))
    }
    if (current.results) {
      window.sessionStorage.setItem('reconciliation_result', JSON.stringify(current.results))
    }
  } catch {}
}

function clearSessionState() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
    window.sessionStorage.removeItem('filePaths')
    window.sessionStorage.removeItem('standardizedData')
    window.sessionStorage.removeItem('reconciliation_result')
  } catch {}
}

// In-memory reactive store
let state: ReconciliationState
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function setState(
  partial: Partial<ReconciliationState> | ((prev: ReconciliationState) => Partial<ReconciliationState>)
) {
  const next = typeof partial === 'function' ? partial(state) : partial
  state = { ...state, ...next }
  saveSessionState(state)
  notify()
}

function getState() {
  return state
}

state = {
  ...initialState,
  ...loadSessionState(),

  setBaseCurrency: (currency: string) => {
    setState({ baseCurrency: (currency || 'INR').toUpperCase().trim() })
  },

  setFile: (key, file) => {
    setState((prev) => ({
      uploadedFiles: { ...prev.uploadedFiles, [key]: file },
      previewData: { ...prev.previewData, [key]: file ? prev.previewData[key] : null },
      error: null,
    }))
  },

  uploadAndPreview: async () => {
    const { invoice, razorpay, bank } = state.uploadedFiles
    if (!invoice || !razorpay || !bank) {
      setState({ error: 'Please select all 3 CSV files before uploading.' })
      return
    }
    setState({ uploadStatus: 'uploading', error: null, activeProgressMessage: 'Uploading files...' })

    try {
      const response = await uploadReconciliationFiles(invoice, razorpay, bank)
      setState({
        uploadStatus: 'uploaded',
        standardizationStatus: 'idle',
        standardizationDuration: null,
        previewData: {
          invoice: response.files.invoice,
          razorpay: response.files.razorpay,
          bank: response.files.bank,
        },
        savedPaths: {
          invoice: response.files.invoice.saved_path,
          razorpay: response.files.razorpay.saved_path,
          bank: response.files.bank.saved_path,
        },
        error: null,
        activeProgressMessage: '',
      })
    } catch (err: any) {
      setState({ uploadStatus: 'error', error: err.message || 'Upload failed', activeProgressMessage: '' })
    }
  },

  standardize: async (baseCurrency?: string) => {
    const invoice = state.savedPaths.invoice || "standardisation/data/raw/invoices.csv"
    const razorpay = state.savedPaths.razorpay || "standardisation/data/raw/razorpay_settlements.csv"
    const bank = state.savedPaths.bank || "standardisation/data/raw/bank.csv"
    const targetCurrency = (baseCurrency || state.baseCurrency || 'INR').toUpperCase().trim()

    setState({
      standardizationStatus: 'running',
      baseCurrency: targetCurrency,
      error: null,
      activeProgressMessage: 'Connecting to AI standardisation engine...',
    })

    try {
      const result = await apiStandardize({
        invoice_path: invoice,
        razorpay_path: razorpay,
        bank_path: bank,
        base_currency: targetCurrency,
      })

      const sf = result.standardized_files
      const finalBaseCurrency = result.base_currency || targetCurrency
      setState({
        standardizationStatus: 'completed',
        baseCurrency: finalBaseCurrency,
        standardizedData: {
          invoice: sf.invoice,
          razorpay: sf.razorpay,
          bank: sf.bank,
        },
        standardizationDuration: result.duration_seconds ?? null,
        activeProgressMessage: `Done in ${result.duration_seconds}s`,
        error: null,
      })
    } catch (err: any) {
      setState({
        standardizationStatus: 'error',
        error: err.message || 'Standardization failed',
        activeProgressMessage: '',
      })
    }
  },

  reconcile: async () => {
    setState({
      reconciliationStatus: 'running',
      error: null,
      activeProgressMessage: 'Running Hungarian matching algorithm...',
    })
    try {
      const results = await apiReconcile(state.reconcileParams)
      setState({
        reconciliationStatus: 'completed',
        results,
        activeProgressMessage: '',
        error: null,
      })
    } catch (err: any) {
      setState({
        reconciliationStatus: 'error',
        error: err.message || 'Reconciliation failed',
        activeProgressMessage: '',
      })
    }
  },

  loadData: async () => {
    try {
      const result = await fetchStandardizedData()
      const sf = result.standardized_files
      if (sf && (sf.invoice || sf.razorpay || sf.bank)) {
        setState((prev) => {
          const newInvoice = sf.invoice
            ? { ...sf.invoice, preview: [...sf.invoice.preview] }
            : prev.standardizedData.invoice
          const newRazorpay = sf.razorpay
            ? { ...sf.razorpay, preview: [...sf.razorpay.preview] }
            : prev.standardizedData.razorpay
          const newBank = sf.bank
            ? { ...sf.bank, preview: [...sf.bank.preview] }
            : prev.standardizedData.bank

          const detectedBase = (
            result.base_currency ||
            newInvoice?.preview?.[0]?.base_currency ||
            newRazorpay?.preview?.[0]?.base_currency ||
            newBank?.preview?.[0]?.base_currency ||
            prev.baseCurrency ||
            'INR'
          ).toString().toUpperCase().trim()

          return {
            standardizationStatus: 'completed',
            baseCurrency: detectedBase,
            standardizedData: {
              invoice: newInvoice,
              razorpay: newRazorpay,
              bank: newBank,
            },
            previewData: {
              invoice: newInvoice || prev.previewData.invoice,
              razorpay: newRazorpay || prev.previewData.razorpay,
              bank: newBank || prev.previewData.bank,
            },
            savedPaths: {
              invoice: sf.invoice?.saved_path || prev.savedPaths.invoice,
              razorpay: sf.razorpay?.saved_path || prev.savedPaths.razorpay,
              bank: sf.bank?.saved_path || prev.savedPaths.bank,
            },
            error: null,
          }
        })
      }
    } catch (err: any) {
      console.error('Error loading standardized data:', err)
    }

    try {
      const modeData = await fetchAgenticMode()
      if (typeof modeData.enabled === 'boolean') {
        setState({ agenticMode: modeData.enabled })
      }
    } catch {}

    try {
      const reconResults = await fetchReconciliationResults()
      if (reconResults && reconResults.triplets) {
        setState((prev) => ({
          reconciliationStatus: 'completed',
          results: {
            ...prev.results,
            ...reconResults,
          },
        }))
      }
    } catch (err: any) {
      // ignore if results not available yet
    }
  },

  setAgenticMode: async (enabled: boolean) => {
    setState({ agenticMode: enabled })
    try {
      const res = await updateAgenticMode(enabled)
      if (typeof res.enabled === 'boolean') {
        setState({ agenticMode: res.enabled })
      }
    } catch (err) {
      console.error('Error setting agentic mode:', err)
    }
  },

  updateVendorName: (fileType, rowIndex, newVendor) => {
    setState((prev) => {
      const source = prev.standardizedData[fileType] || prev.previewData[fileType]
      if (!source) return prev
      const updatedPreview = [...source.preview]
      if (updatedPreview[rowIndex]) {
        updatedPreview[rowIndex] = {
          ...updatedPreview[rowIndex],
          vendor_standardized: newVendor,
          vendor: newVendor,
        }
      }
      const updated: FilePreviewData = { ...source, preview: updatedPreview }
      return {
        standardizedData: { ...prev.standardizedData, [fileType]: updated },
        previewData: { ...prev.previewData, [fileType]: updated },
      }
    })
  },

  updateRow: async (fileType, rowIndex, rowId, updatedData) => {
    try {
      const res = await updateStandardizedRow({
        source: fileType,
        rowId: rowId ?? undefined,
        rowIndex,
        updatedData,
      })

      if (res.status === 'success' && res.preview) {
        setState((prev) => ({
          standardizedData: {
            ...prev.standardizedData,
            [fileType]: res.preview,
          },
          previewData: {
            ...prev.previewData,
            [fileType]: res.preview,
          },
        }))
        return { success: true }
      }

      // Fallback local update
      setState((prev) => {
        const source = prev.standardizedData[fileType] || prev.previewData[fileType]
        if (!source) return prev
        const updatedPreview = [...source.preview]
        if (updatedPreview[rowIndex]) {
          updatedPreview[rowIndex] = {
            ...updatedPreview[rowIndex],
            ...updatedData,
          }
        }
        const updated: FilePreviewData = { ...source, preview: updatedPreview }
        return {
          standardizedData: { ...prev.standardizedData, [fileType]: updated },
          previewData: { ...prev.previewData, [fileType]: updated },
        }
      })
      return { success: true }
    } catch (err: any) {
      console.error('Error updating row in backend:', err)
      return { success: false, error: err.message || 'Failed to update row' }
    }
  },

  resolveExceptions: async (exceptionIds: string[], mode: 'memo' | 'direct' | 'manual', resolutionNote?: string) => {
    try {
      const res = await resolveExceptionsApi({
        exception_ids: exceptionIds,
        mode,
        resolution_note: resolutionNote,
      })

      if (res.status === 'success' || res.success) {
        if (res.exceptions) {
          setState((prev) => {
            if (!prev.results) return prev
            const resolvedAmt = res.exceptions
              ? res.exceptions
                  .filter((e) => e.status_type === 'resolved' || e.status === 'Resolved')
                  .reduce((sum, e) => sum + (e.amount || 0), 0)
              : 0

            return {
              results: {
                ...prev.results,
                exceptions: res.exceptions || [],
                unallocatedCount: res.unallocatedCount ?? prev.results.unallocatedCount,
                auditExceptionCount: res.auditExceptionCount ?? prev.results.auditExceptionCount,
                resolvedCount: res.resolvedCount ?? prev.results.resolvedCount,
                totalResolvedAmount: resolvedAmt,
              },
            }
          })
        } else {
          // Optimistic update
          setState((prev) => {
            if (!prev.results || !prev.results.exceptions) return prev
            const cleanIds = exceptionIds.map((id) => String(id).toLowerCase().trim())
            const updated = prev.results.exceptions.map((exc) => {
              const excIdStr = (exc.id + ' ' + exc.source_id).toLowerCase()
              const isMatch = cleanIds.some((cid) => excIdStr.includes(cid))
              if (isMatch) {
                return {
                  ...exc,
                  status: 'Resolved',
                  status_type: 'resolved',
                  severity: 'Resolved',
                  resolution_note: resolutionNote || exc.resolution_note || 'Resolved',
                  resolved_at: new Date().toISOString(),
                }
              }
              return exc
            })

            const unallocatedCount = updated.filter((e) => e.status_type === 'unallocated_cash' && e.status !== 'Resolved').length
            const auditExceptionCount = updated.filter((e) => e.status_type === 'exception' && e.status !== 'Resolved').length
            const resolvedCount = updated.filter((e) => e.status_type === 'resolved' || e.status === 'Resolved').length
            const resolvedAmt = updated.filter((e) => e.status_type === 'resolved' || e.status === 'Resolved').reduce((sum, e) => sum + (e.amount || 0), 0)

            return {
              results: {
                ...prev.results,
                exceptions: updated,
                unallocatedCount,
                auditExceptionCount,
                resolvedCount,
                totalResolvedAmount: resolvedAmt,
              },
            }
          })
        }
        return {
          success: true,
          memo_text: res.memo_text,
          requires_confirmation: res.requires_confirmation,
          result: res.result,
        }
      }

      return { success: false, error: res.error || 'Failed to resolve exceptions' }
    } catch (err: any) {
      console.error('Error resolving exceptions:', err)
      return { success: false, error: err.message || 'Network error while resolving exceptions' }
    }
  },

  setReconcileParams: (params) => {
    setState((prev) => ({ reconcileParams: { ...prev.reconcileParams, ...params } }))
  },

  resetAll: () => {
    clearSessionState()
    setState(initialState)
  },
}

let isHydrated = false
export function hydrateStoreFromSession() {
  if (typeof window === 'undefined' || isHydrated) return
  isHydrated = true
  const loaded = loadSessionState()
  if (Object.keys(loaded).length > 0) {
    setState(loaded)
  }
}

// React hook with safe client-side hydration
export function useReconciliationStore<T = ReconciliationState>(
  selector?: (s: ReconciliationState) => T
): T {
  useEffect(() => {
    hydrateStoreFromSession()
  }, [])

  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (selector ? selector(state) : (state as unknown as T)),
    () => (selector ? selector(state) : (state as unknown as T))
  )
}

export const reconciliationStore = { getState, setState }
