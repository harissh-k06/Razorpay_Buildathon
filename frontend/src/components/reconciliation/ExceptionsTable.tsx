"use client"

import React, { useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { useReconciliationStore } from "@/store/reconciliationStore"
import {
  AlertTriangleIcon,
  FilterIcon,
  ShieldAlertIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  HelpCircleIcon,
} from "lucide-react"

export function ExceptionsTable() {
  const { results, reconciliationStatus } = useReconciliationStore()
  const [filterType, setFilterType] = useState<string>("ALL")

  if (reconciliationStatus !== "completed" || !results || !results.exceptions) {
    return null
  }

  const filteredExceptions = results.exceptions.filter((exc) => {
    if (filterType === "ALL") return true
    if (filterType === "EXCEPTIONS") {
      const type = exc.type.toLowerCase()
      const reason = (exc.reason || "").toLowerCase()
      if (type === "invoice" && (reason.includes("no matching razorpay") || reason.includes("settlement") || reason.includes("unmatched"))) return true
      if (type === "razorpay" && (reason.includes("no matching bank") || reason.includes("bank deposit"))) return true
      if (type === "bank" && reason.includes("no matching razorpay settlement") && !reason.includes("invoice")) return true
      if (type === "invoice") return true
      if (type === "razorpay" && !reason.includes("no matching invoice")) return true
      return false
    }
    if (filterType === "UNALLOCATED") {
      const type = exc.type.toLowerCase()
      const reason = (exc.reason || "").toLowerCase()
      if (type === "razorpay" && (reason.includes("no matching invoice") || reason.includes("without invoice") || reason.includes("unallocated"))) return true
      if (type === "bank" && (reason.includes("no matching invoice") || reason.includes("unallocated") || reason.includes("settlement or invoice"))) return true
      return false
    }
    return exc.type.toUpperCase() === filterType.toUpperCase()
  })

  return (
    <Card className="border-border shadow-xs">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
              <AlertTriangleIcon className="size-4" />
            </div>
            <CardTitle className="text-lg font-semibold text-text-primary">
              Exceptions &amp; Unallocated Cash
            </CardTitle>
          </div>
          <CardDescription className="mt-1 text-xs text-text-muted">
            Missing cash exceptions (unmatched invoices, missing bank deposits) and unallocated cash (funds received without invoices).
          </CardDescription>
        </div>

        <div className="flex items-center gap-1.5 bg-surface-2 p-1 rounded-lg flex-wrap">
          {[
            { key: "ALL", label: "All Items" },
            { key: "EXCEPTIONS", label: "Exceptions (Missing Cash)" },
            { key: "UNALLOCATED", label: "Unallocated Cash (Extra Cash)" },
            { key: "INVOICE", label: "Invoices" },
            { key: "RAZORPAY", label: "Razorpay" },
            { key: "BANK", label: "Bank Credits" },
          ].map((t) => (
            <Button
              key={t.key}
              size="sm"
              variant={filterType === t.key ? "default" : "ghost"}
              className={`h-7 px-2.5 text-xs font-medium ${
                filterType === t.key
                  ? "bg-background text-text-primary shadow-xs font-semibold"
                  : "text-text-muted hover:text-text-primary"
              }`}
              onClick={() => setFilterType(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        <div className="overflow-hidden rounded-xl border border-border bg-background shadow-2xs">
          <Table>
            <TableHeader className="bg-surface-2/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 text-center text-xs font-semibold text-text-primary">
                  #
                </TableHead>
                <TableHead className="text-xs font-semibold text-text-primary">
                  Stream Type
                </TableHead>
                <TableHead className="text-xs font-semibold text-text-primary">
                  Source ID
                </TableHead>
                <TableHead className="text-xs font-semibold text-text-primary">
                  Vendor Name
                </TableHead>
                <TableHead className="text-right text-xs font-semibold text-text-primary">
                  Amount
                </TableHead>
                <TableHead className="text-xs font-semibold text-text-primary">
                  Date
                </TableHead>
                <TableHead className="text-xs font-semibold text-text-primary">
                  Exception Root Cause / Reason
                </TableHead>
                <TableHead className="w-24 text-center text-xs font-semibold text-text-primary">
                  Severity
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredExceptions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-xs text-text-muted">
                    No exceptions found for category "{filterType}".
                  </TableCell>
                </TableRow>
              ) : (
                filteredExceptions.map((exc, idx) => {
                  const typeColor =
                    exc.type === "Invoice"
                      ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300"
                      : exc.type === "Razorpay"
                      ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300"
                      : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300"

                  const sev = (exc.severity || (exc.type === "Invoice" ? "High" : exc.type === "Bank" ? "Low" : "Medium")).toLowerCase()
                  const sevColor = sev === "high" ? "#FF0000" : sev === "low" ? "#0CA72F" : "#F59E0B"
                  const sevLabel = sev === "high" ? "High" : sev === "low" ? "Low" : "Medium"

                  return (
                    <TableRow
                      key={exc.id || idx}
                      className={
                        idx % 2 === 1
                          ? "bg-surface-1/40 hover:bg-surface-2/50"
                          : "hover:bg-surface-2/50"
                      }
                    >
                      <TableCell className="text-center font-mono text-xs text-text-disabled">
                        {idx + 1}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-semibold ${typeColor}`}
                        >
                          {exc.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-text-primary">
                        {exc.source_id}
                      </TableCell>
                      <TableCell className="text-xs font-medium text-text-primary">
                        {exc.vendor}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold text-rose-600 dark:text-rose-400">
                        ${Number(exc.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-text-muted">
                        {exc.date}
                      </TableCell>
                      <TableCell className="text-xs text-text-secondary max-w-xs">
                        <div className="flex items-start gap-1.5">
                          <HelpCircleIcon className="size-3.5 shrink-0 text-amber-500 mt-0.5" />
                          <span>{exc.reason}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          style={{
                            color: sevColor,
                            backgroundColor: `${sevColor}1F`,
                            borderColor: `${sevColor}4D`
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border"
                        >
                          <span className="size-1.5 rounded-full" style={{ backgroundColor: sevColor }} />
                          {sevLabel}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
