import Image from "next/image"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { recentTransactions } from "@/data/seed"
import {
  MoreHorizontalIcon,
  ChevronRightIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

const categoryColors: Record<string, string> = {
  Entertainment: "bg-[#75A3FF]/15 text-[#2950DA]",
  Technology: "bg-surface-2 text-[#305EFF]",
  Income: "bg-[#48D08C]/20 text-[#006C3F]",
  Design: "bg-surface-3 text-[#243547]",
  "AI Tools": "bg-surface-2 text-[#032A3E]",
  Productivity: "bg-surface-2 text-[#305EFF]",
}

export function RecentTransactions() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-semibold">
          Recent Transactions
        </CardTitle>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
          See All
          <ChevronRightIcon className="size-3" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[600px] space-y-1">
            {/* Header */}
            <div className="grid grid-cols-[1fr_140px_100px_120px_32px] gap-4 border-b border-border pb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
              <span>Merchant</span>
              <span className="hidden sm:inline">Transaction ID</span>
              <span className="text-right">Amount</span>
              <span className="hidden md:inline">Date</span>
              <span />
            </div>

            {/* Rows */}
            {recentTransactions.map((tx) => (
              <div
                key={tx.id}
                className="group grid grid-cols-[1fr_140px_100px_120px_32px] items-center gap-4 rounded-lg py-2.5 transition-colors hover:bg-surface-1"
              >
                {/* Merchant */}
                <div className="flex items-center gap-3">
                  <Image
                    src={tx.logo}
                    alt={tx.merchant}
                    width={36}
                    height={36}
                    className="size-9 shrink-0 rounded-lg object-contain bg-surface-2 p-1"
                    unoptimized
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">{tx.merchant}</p>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "mt-0.5 h-5 rounded-md px-1.5 text-[10px] font-medium",
                        categoryColors[tx.category] ?? "bg-surface-2 text-text-secondary"
                      )}
                    >
                      {tx.category}
                    </Badge>
                  </div>
                </div>

                {/* Transaction ID */}
                <span className="hidden font-mono text-xs text-text-muted sm:inline">
                  {tx.transactionId}
                </span>

                {/* Amount */}
                <span
                  className={cn(
                    "text-right text-sm font-semibold tabular-nums",
                    tx.amount > 0
                      ? "text-success"
                      : "text-text-primary"
                  )}
                >
                  {tx.amount > 0 ? "+" : ""}$
                  {Math.abs(tx.amount).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                  })}
                </span>

                {/* Date */}
                <span className="hidden text-xs text-text-muted md:inline">{tx.date}</span>

                {/* Actions */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
