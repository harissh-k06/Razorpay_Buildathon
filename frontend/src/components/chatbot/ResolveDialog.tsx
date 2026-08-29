"use client"

import React, { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn, formatCurrency } from "@/lib/utils"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { MailIcon, FileTextIcon, ArrowRightIcon, AlertCircleIcon } from "lucide-react"
import { ReconciliationException } from "@/lib/reconciliation-types"

interface ResolveDialogProps {
  open: boolean
  onClose: () => void
  exception?: ReconciliationException | null
  exceptions?: ReconciliationException[]
  onConfirm: (action: "memo" | "email", recipient?: string) => void
}

export function ResolveDialog({ open, onClose, exception, exceptions, onConfirm }: ResolveDialogProps) {
  const baseCurrency = useReconciliationStore((state) => state.baseCurrency) || "INR"
  const [selectedAction, setSelectedAction] = useState<"memo" | "email">("memo")
  const [recipientEmail, setRecipientEmail] = useState("")
  const [emailError, setEmailError] = useState("")

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedAction("memo")
      setRecipientEmail("")
      setEmailError("")
    }
  }, [open])

  const validateEmail = (email: string) => {
    if (!email) return "Recipient email is required"
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address"
    return ""
  }

  const handleContinue = () => {
    if (selectedAction === "email") {
      const err = validateEmail(recipientEmail)
      if (err) {
        setEmailError(err)
        return
      }
    }
    onConfirm(selectedAction, selectedAction === "email" ? recipientEmail : undefined)
    onClose()
  }

  const allExceptions = exceptions && exceptions.length > 0 ? exceptions : exception ? [exception] : []
  const isBatch = allExceptions.length > 1
  const count = allExceptions.length
  const totalAmount = allExceptions.reduce((sum, e) => sum + (e.amount || 0), 0)
  const totalAmountStr = totalAmount > 0 ? formatCurrency(totalAmount, baseCurrency) : ""

  const excId = exception?.source_id || exception?.id || ""
  const excVendor = exception?.vendor || ""
  const excAmount = exception?.amount != null ? formatCurrency(exception.amount, baseCurrency) : ""

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">
            {isBatch ? `Resolve ${count} Exceptions with PennyWise AI` : "Resolve with PennyWise AI"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            {isBatch ? (
              <span className="inline-flex items-center gap-1.5 font-mono">
                <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-border text-[11px] font-semibold text-text-primary">
                  {count} records selected
                </span>
                {totalAmountStr && (
                  <span className="font-semibold text-[#0D94FB]">· Total: {totalAmountStr}</span>
                )}
              </span>
            ) : excId ? (
              <span className="inline-flex items-center gap-1.5 font-mono">
                <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-border text-[11px]">{excId}</span>
                {excVendor && <span className="text-text-secondary">· {excVendor}</span>}
                {excAmount && <span className="font-semibold text-[#0D94FB]">{excAmount}</span>}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {/* Action Selection */}
        <div className="mt-2 space-y-3">
          <p className="text-xs font-medium text-text-secondary">
            {isBatch ? `How would you like to handle these ${count} exceptions?` : "How would you like to handle this exception?"}
          </p>

          <div className="grid grid-cols-2 gap-3">
            {/* Draft Memo option */}
            <button
              id="resolve-option-memo"
              type="button"
              onClick={() => setSelectedAction("memo")}
              className={cn(
                "flex flex-col items-center gap-2.5 rounded-xl border-2 p-4 text-left transition-all duration-200 cursor-pointer",
                selectedAction === "memo"
                  ? "border-[#0D94FB] bg-[#0D94FB]/5"
                  : "border-border bg-card hover:border-[#0D94FB]/40 hover:bg-surface-1"
              )}
            >
              <div className={cn(
                "flex size-10 items-center justify-center rounded-lg transition-colors",
                selectedAction === "memo"
                  ? "bg-[#0D94FB]/15 text-[#0D94FB]"
                  : "bg-surface-2 text-text-muted"
              )}>
                <FileTextIcon className="size-5" />
              </div>
              <div>
                <p className={cn(
                  "text-xs font-semibold",
                  selectedAction === "memo" ? "text-[#0D94FB]" : "text-text-primary"
                )}>
                  Draft Memo
                </p>
                <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                  {isBatch
                    ? `Generate formal dispute or allocation memos for all ${count} records`
                    : "Generate a formal dispute or allocation memo for internal records"}
                </p>
              </div>
              <div className={cn(
                "size-3.5 rounded-full border-2 mt-auto transition-all",
                selectedAction === "memo"
                  ? "border-[#0D94FB] bg-[#0D94FB]"
                  : "border-border bg-transparent"
              )} />
            </button>

            {/* Send Email option */}
            <button
              id="resolve-option-email"
              type="button"
              onClick={() => setSelectedAction("email")}
              className={cn(
                "flex flex-col items-center gap-2.5 rounded-xl border-2 p-4 text-left transition-all duration-200 cursor-pointer",
                selectedAction === "email"
                  ? "border-emerald-500 bg-emerald-500/5"
                  : "border-border bg-card hover:border-emerald-500/40 hover:bg-surface-1"
              )}
            >
              <div className={cn(
                "flex size-10 items-center justify-center rounded-lg transition-colors",
                selectedAction === "email"
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-surface-2 text-text-muted"
              )}>
                <MailIcon className="size-5" />
              </div>
              <div>
                <p className={cn(
                  "text-xs font-semibold",
                  selectedAction === "email" ? "text-emerald-600 dark:text-emerald-400" : "text-text-primary"
                )}>
                  Send Email
                </p>
                <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                  {isBatch
                    ? `Draft and send a consolidated email covering all ${count} records`
                    : "Draft and send a professional email to the vendor or counterparty"}
                </p>
              </div>
              <div className={cn(
                "size-3.5 rounded-full border-2 mt-auto transition-all",
                selectedAction === "email"
                  ? "border-emerald-500 bg-emerald-500"
                  : "border-border bg-transparent"
              )} />
            </button>
          </div>

          {/* Recipient email field – shown only when Send Email is selected */}
          {selectedAction === "email" && (
            <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
              <Label htmlFor="recipient-email" className="text-xs font-medium text-text-secondary">
                Recipient Email Address <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <MailIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-text-disabled pointer-events-none" />
                <Input
                  id="recipient-email"
                  type="email"
                  placeholder="vendor@example.com"
                  value={recipientEmail}
                  onChange={(e) => {
                    setRecipientEmail(e.target.value)
                    if (emailError) setEmailError(validateEmail(e.target.value))
                  }}
                  className={cn(
                    "pl-9 h-9 text-sm",
                    emailError ? "border-destructive focus-visible:ring-destructive" : ""
                  )}
                />
              </div>
              {emailError && (
                <p className="flex items-center gap-1 text-[11px] text-destructive">
                  <AlertCircleIcon className="size-3" />
                  {emailError}
                </p>
              )}
              <p className="text-[10px] text-text-muted">
                PennyWise will draft the email for you to review before sending.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 gap-2 sm:gap-2">
          <Button
            id="resolve-dialog-cancel"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-8 text-xs"
          >
            Cancel
          </Button>
          <Button
            id="resolve-dialog-continue"
            size="sm"
            onClick={handleContinue}
            className={cn(
              "h-8 text-xs font-semibold gap-1.5",
              selectedAction === "email"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-[#0D94FB] hover:bg-[#0D94FB]/90 text-white"
            )}
          >
            Continue
            <ArrowRightIcon className="size-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
