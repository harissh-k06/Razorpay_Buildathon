"use client"

import React, { useEffect } from "react"
import { useRouter } from "next/navigation"
import { LandmarkIcon, Loader2 } from "lucide-react"
import { useAuthStore } from "@/store/authStore"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { PIPELINE_ROUTES, getInitialPipelineRoute } from "@/lib/routes"

export { PIPELINE_ROUTES, PIPELINE_STEPS, getInitialPipelineRoute, resolvePennyWiseActionRoute } from "@/lib/routes"

export default function RootPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore()
  const results = useReconciliationStore((state) => state.results)
  const standardizedData = useReconciliationStore((state) => state.standardizedData)
  const uploadStatus = useReconciliationStore((state) => state.uploadStatus)

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  useEffect(() => {
    if (isLoading) return

    if (!isAuthenticated) {
      router.replace(PIPELINE_ROUTES.SIGN_IN)
      return
    }

    const hasResults = Boolean(results && results.triplets && results.triplets.length > 0)
    const hasStandardizedData = Boolean(
      standardizedData.invoice || standardizedData.razorpay || standardizedData.bank
    )
    const hasUploadedFiles = uploadStatus === "uploaded"

    const targetRoute = getInitialPipelineRoute({
      hasResults,
      hasStandardizedData,
      hasUploadedFiles,
    })

    router.replace(targetRoute)
  }, [isAuthenticated, isLoading, results, standardizedData, uploadStatus, router])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 animate-pulse">
          <LandmarkIcon className="size-7" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight text-foreground">PennyWise</h1>
          <p className="text-xs text-muted-foreground">Your Khata Agent</p>
        </div>
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span>Routing to reconciliation pipeline...</span>
        </div>
      </div>
    </div>
  )
}
