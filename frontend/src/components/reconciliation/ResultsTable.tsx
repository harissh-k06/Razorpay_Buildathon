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
import { Input } from "@/components/ui/input"
import { useReconciliationStore } from "@/store/reconciliationStore"
import {
  CheckCircle2Icon,
  SearchIcon,
  DownloadIcon,
  SparklesIcon,
  ArrowUpDownIcon,
  FilterIcon,
  ShieldCheckIcon,
} from "lucide-react"

export function ResultsTable() {
  const { results, reconciliationStatus } = useReconciliationStore()
  const [searchTerm, setSearchTerm] = useState("")
  const [sortBy, setSortBy] = useState<"amount" | "id">("id")
  const [sortAsc, setSortAsc] = useState(true)

  if (reconciliationStatus !== "completed" || !results || !results.triplets) {
    return null
  }

  const triplets = results.triplets.filter((item) => {
    const q = searchTerm.toLowerCase()
    return (
      item.invoice_id.toLowerCase().includes(q) ||
      item.razorpay_id.toLowerCase().includes(q) ||
      item.bank_ref_no.toLowerCase().includes(q) ||
      (item.vendor && item.vendor.toLowerCase().includes(q))
    )
  })

  const sortedTriplets = [...triplets].sort((a, b) => {
    if (sortBy === "amount") {
      return sortAsc ? a.amount - b.amount : b.amount - a.amount
    }
    return sortAsc
      ? a.invoice_id.localeCompare(b.invoice_id)
      : b.invoice_id.localeCompare(a.invoice_id)
  })

  const exportCSV = () => {
    const headers = [
      "Triplet_ID",
      "Invoice_ID",
      "Razorpay_ID",
      "Bank_Ref_No",
      "Vendor",
      "Amount",
      "Status",
      "Match_Type",
    ]
    const rows = sortedTriplets.map((t) => [
      t.id,
      t.invoice_id,
      t.razorpay_id,
      t.bank_ref_no,
      `"${t.vendor || ""}"`,
      t.amount,
      t.status,
      t.match_type || "Exact",
    ])
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n")
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `matched_triplets_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <Card className="border-border shadow-xs">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <CheckCircle2Icon className="size-4" />
            </div>
            <CardTitle className="text-lg font-semibold text-text-primary">
              Matched Triplets (3-Way Hungarian Reconciled)
            </CardTitle>
          </div>
          <CardDescription className="mt-1 text-xs text-text-muted">
            High-confidence matching across Invoice, Razorpay Settlement UTR, and Bank Core Ledger.
          </CardDescription>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative w-48 sm:w-64">
            <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-disabled" />
            <Input
              placeholder="Search Invoice, RZP, UTR..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 pl-8 text-xs bg-background"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            className="h-8 text-xs font-medium border-border"
          >
            <DownloadIcon className="mr-1.5 size-3.5" />
            Export CSV
          </Button>
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
                <TableHead
                  className="cursor-pointer text-xs font-semibold text-text-primary hover:text-primary"
                  onClick={() => {
                    setSortBy("id")
                    setSortAsc(!sortAsc)
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span>Invoice ID</span>
                    <ArrowUpDownIcon className="size-3 text-text-disabled" />
                  </div>
                </TableHead>
                <TableHead className="text-xs font-semibold text-text-primary">
                  Razorpay ID
                </TableHead>
                <TableHead className="text-xs font-semibold text-text-primary">
                  Bank Ref No
                </TableHead>
                <TableHead className="text-xs font-semibold text-text-primary">
                  Vendor
                </TableHead>
                <TableHead
                  className="cursor-pointer text-right text-xs font-semibold text-text-primary hover:text-primary"
                  onClick={() => {
                    setSortBy("amount")
                    setSortAsc(!sortAsc)
                  }}
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Amount</span>
                    <ArrowUpDownIcon className="size-3 text-text-disabled" />
                  </div>
                </TableHead>
                <TableHead className="text-center text-xs font-semibold text-text-primary">
                  Match Type
                </TableHead>
                <TableHead className="w-24 text-right text-xs font-semibold text-text-primary">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTriplets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-xs text-text-muted">
                    No matched records found matching "{searchTerm}"
                  </TableCell>
                </TableRow>
              ) : (
                sortedTriplets.map((item, idx) => (
                  <TableRow
                    key={item.id || idx}
                    className={
                      idx % 2 === 1
                        ? "bg-surface-1/40 hover:bg-surface-2/50"
                        : "hover:bg-surface-2/50"
                    }
                  >
                    <TableCell className="text-center font-mono text-xs text-text-disabled">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold text-text-primary">
                      {item.invoice_id}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-text-secondary">
                      <span className="rounded bg-surface-2 px-1.5 py-0.5">
                        {item.razorpay_id}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-text-secondary">
                      {item.bank_ref_no}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-text-primary">
                      {item.vendor || "GLOBAL VENDOR"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-text-primary">
                      ${Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4.5 px-1.5 font-mono text-primary bg-primary/10 border-primary/20"
                      >
                        {item.match_type || "1:1 Exact"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="default"
                        className="bg-emerald-600 text-white text-[11px] h-5 px-2 font-medium"
                      >
                        <ShieldCheckIcon className="mr-1 size-3" />
                        {item.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
