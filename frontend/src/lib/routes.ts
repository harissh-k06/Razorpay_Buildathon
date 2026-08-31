/**
 * Single Source of Truth for all Application Routes & PennyWise Action Dispatches
 */

export const PIPELINE_ROUTES = {
  UPLOAD: "/reconciliation/upload",
  STANDARDIZE: "/reconciliation/standardize",
  REVIEW: "/reconciliation/review",
  RESULTS: "/reconciliation/results",
  SIGN_IN: "/sign-in",
  SIGN_UP: "/sign-up",
} as const

export type PipelineStepKey = "upload" | "standardize" | "review" | "results"

export interface PipelineStepMeta {
  key: PipelineStepKey
  label: string
  href: string
  description: string
}

export const PIPELINE_STEPS: readonly PipelineStepMeta[] = [
  {
    key: "upload",
    label: "Upload Files",
    href: PIPELINE_ROUTES.UPLOAD,
    description: "Ingest Invoice, Razorpay, and Bank Statement CSVs.",
  },
  {
    key: "standardize",
    label: "Standardize",
    href: PIPELINE_ROUTES.STANDARDIZE,
    description: "AI-powered entity resolution, date parsing, and currency alignment.",
  },
  {
    key: "review",
    label: "Review",
    href: PIPELINE_ROUTES.REVIEW,
    description: "Inspect standardized datasets, configure tolerances, and adjust rows.",
  },
  {
    key: "results",
    label: "Results",
    href: PIPELINE_ROUTES.RESULTS,
    description: "3-way Hungarian matching, analytics graphs, and exception memos.",
  },
] as const

/**
 * Calculates the best pipeline landing route based on active store state.
 */
export function getInitialPipelineRoute(state?: {
  hasResults?: boolean
  hasStandardizedData?: boolean
  hasUploadedFiles?: boolean
}): string {
  if (state?.hasResults) return PIPELINE_ROUTES.RESULTS
  if (state?.hasStandardizedData) return PIPELINE_ROUTES.REVIEW
  if (state?.hasUploadedFiles) return PIPELINE_ROUTES.STANDARDIZE
  return PIPELINE_ROUTES.UPLOAD
}

/**
 * Resolves PennyWise AI action events (SSE or FastMCP tool executions) to target routes.
 */
export function resolvePennyWiseActionRoute(action: string): string {
  const clean = (action || "").toLowerCase().trim()
  switch (clean) {
    case "reconcile":
    case "results":
    case "view_results":
      return PIPELINE_ROUTES.RESULTS

    case "standardize":
    case "re_standardize":
      return PIPELINE_ROUTES.STANDARDIZE

    case "review":
    case "bulk_update":
    case "update_row":
    case "data_updated":
      return PIPELINE_ROUTES.REVIEW

    case "upload":
    case "new_session":
    case "reset":
    default:
      return PIPELINE_ROUTES.UPLOAD
  }
}
