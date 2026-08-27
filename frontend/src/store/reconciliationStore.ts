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
  fetchAgenticMode,
  updateAgenticMode,
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

  // Actions
  setFile: (key: keyof UploadedFilesMap, file: File | null) => void
  uploadAndPreview: () => Promise<void>
  standardize: (baseCurrency?: string) => Promise<void>
  reconcile: () => Promise<void>
  loadData: () => Promise<void>
  updateVendorName: (fileType: 'invoice' | 'razorpay' | 'bank', rowIndex: number, newVendor: string) => void
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
  | 'setFile'
  | 'uploadAndPreview'
  | 'standardize'
  | 'reconcile'
  | 'loadData'
  | 'updateVendorName'
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

    setState({
      standardizationStatus: 'running',
      error: null,
      activeProgressMessage: 'Connecting to AI standardisation engine...',
    })

    try {
      const result = await apiStandardize({
        invoice_path: invoice,
        razorpay_path: razorpay,
        bank_path: bank,
        base_currency: (baseCurrency || 'INR').toUpperCase(),
      })

      const sf = result.standardized_files
      setState({
        standardizationStatus: 'completed',
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
        setState((prev) => ({
          standardizationStatus: 'completed',
          standardizedData: {
            invoice: sf.invoice
              ? { ...sf.invoice, preview: [...sf.invoice.preview] }
              : prev.standardizedData.invoice,
            razorpay: sf.razorpay
              ? { ...sf.razorpay, preview: [...sf.razorpay.preview] }
              : prev.standardizedData.razorpay,
            bank: sf.bank
              ? { ...sf.bank, preview: [...sf.bank.preview] }
              : prev.standardizedData.bank,
          },
          savedPaths: {
            invoice: sf.invoice?.saved_path || prev.savedPaths.invoice,
            razorpay: sf.razorpay?.saved_path || prev.savedPaths.razorpay,
            bank: sf.bank?.saved_path || prev.savedPaths.bank,
          },
          error: null,
        }))
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
