"use client"

import React from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import {
  DollarSignIcon,
  TrendingUpIcon,
  LandmarkIcon,
  ReceiptIcon,
  ScaleIcon,
  AlertCircleIcon,
  CoinsIcon,
} from "lucide-react"

interface FinancialFlowChartProps {
  gross: number
  bank: number
  fees?: number
  invoiceTax?: number
  uncollected?: number
  unallocated?: number
  baseCurrency?: string
}

export function FinancialFlowChart({
  gross,
  bank,
  fees = 0,
  invoiceTax = 0,
  uncollected,
  unallocated,
  baseCurrency = "INR",
}: FinancialFlowChartProps) {
  const computedInvoiceTax = invoiceTax
  const computedFees = fees
  const computedUncollected = uncollected !== undefined ? uncollected : 0
  const computedUnallocated = unallocated !== undefined ? unallocated : 0

  // Net operating income derived strictly from matched customer invoices
  const netRetainedIncome = Math.max(0, gross - (computedInvoiceTax + computedFees + computedUncollected))
  const safeGross = gross > 0 ? gross : 1

  const data = [
    {
      name: "1. Total Gross Pay (Invoiced Volume)",
      shortName: "Gross Pay (Billed)",
      amount: gross,
      percent: +((gross / safeGross) * 100).toFixed(1),
      color: "#0C2651", // Deep Navy Brand Color
      icon: TrendingUpIcon,
      desc: "Total revenue billed to customers (Net In-Hand + Government Tax + Razorpay Fees + Missing Cash)",
    },
    {
      name: "2. Net Retained Income (In-Hand Cash)",
      shortName: "Net Income (In-Hand)",
      amount: netRetainedIncome,
      percent: +((netRetainedIncome / safeGross) * 100).toFixed(1),
      color: "#10B981", // Success Green (#009E5C)
      icon: LandmarkIcon,
      desc: `Net operating profit credited to bank from invoices (${formatCurrency(netRetainedIncome, baseCurrency)})`,
    },
    {
      name: "3. Government Tax (Invoice Tax)",
      shortName: "Government Tax",
      amount: computedInvoiceTax,
      percent: +((computedInvoiceTax / safeGross) * 100).toFixed(1),
      color: "#8B5CF6", // Purple (Government / Regulatory)
      icon: ScaleIcon,
      desc: "Sales tax / GST on customer invoices collected for statutory government remittance",
    },
    {
      name: "4. Razorpay Deductions (Fee + Gateway Tax)",
      shortName: "Razorpay Deductions",
      amount: computedFees,
      percent: +((computedFees / safeGross) * 100).toFixed(1),
      color: "#0D94FB", // Razorpay Blue (matching donut & gauge chart)
      icon: ReceiptIcon,
      desc: "Total payment gateway deductions (MDR Transaction Fee + GST on fee)",
    },
    {
      name: "5. Missing Cash (Uncollected Invoices)",
      shortName: "Missing Cash (Exceptions)",
      amount: computedUncollected,
      percent: +((computedUncollected / safeGross) * 100).toFixed(1),
      color: "#EF4444", // Coral Red
      icon: AlertCircleIcon,
      desc: "Outstanding billing invoices not yet captured or settled by payment gateway",
    },
    {
      name: "6. Unallocated Cash (Extra Gateway Settlements)",
      shortName: "Unallocated Cash",
      amount: computedUnallocated,
      percent: +((computedUnallocated / safeGross) * 100).toFixed(1),
      color: "#F59E0B", // Golden Yellow / Amber
      icon: CoinsIcon,
      desc: "Extra payments received in bank / Razorpay without a matching invoice",
    },
  ]

  const maxVal = Math.max(gross, netRetainedIncome, computedInvoiceTax, computedFees, computedUncollected, computedUnallocated, 1)
  const xMax = maxVal * 1.15

  const formatTick = (value: number) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`
    return `${value}`
  }

  return (
    <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
      <CardHeader className="bg-surface-1/60 border-b border-border/50 py-2.5 px-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <div className="flex size-5 items-center justify-center rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <DollarSignIcon className="size-3.5" />
              </div>
              <CardTitle className="text-sm font-bold text-text-primary">
                Financial Flow &amp; Settlement Realisation
              </CardTitle>
            </div>
            <CardDescription className="text-[11px] text-text-muted mt-0.5">
              Complete balanced realization flow: Gross Billed ({formatCurrency(gross, baseCurrency)}) = Net In-Hand ({formatCurrency(netRetainedIncome, baseCurrency)}) + Govt Tax ({formatCurrency(computedInvoiceTax, baseCurrency)}) + Razorpay ({formatCurrency(computedFees, baseCurrency)}) + Missing Cash ({formatCurrency(computedUncollected, baseCurrency)}).
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px] text-text-muted">
              Gross Benchmark: {formatCurrency(gross, baseCurrency)}
            </Badge>
            <Badge
              variant="outline"
              className="bg-[#0D94FB]/10 text-[#0D94FB] border-[#0D94FB]/25 font-mono text-[11px] font-bold"
            >
              Base: {baseCurrency}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 pb-3.5 px-4 bg-card text-foreground">
        <div className="relative h-[360px] w-full min-w-0 min-h-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <BarChart
              layout="vertical"
              data={data}
              margin={{ top: 26, right: 40, left: 20, bottom: 5 }}
              barCategoryGap="16%"
            >
              <CartesianGrid
                strokeDasharray="3 3"
                horizontal={false}
                stroke="currentColor"
                className="text-border/40"
              />
              <XAxis
                type="number"
                domain={[0, xMax]}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatTick}
                tick={{ fill: "currentColor", fontSize: 10 }}
                className="text-text-muted font-mono"
              />
              <YAxis
                type="category"
                dataKey="shortName"
                axisLine={false}
                tickLine={false}
                width={150}
                tick={{ fill: "currentColor", fontSize: 11, fontWeight: 600 }}
                className="text-text-primary"
              />
              <RechartsTooltip
                cursor={{ fill: "currentColor", opacity: 0.05 }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload
                    return (
                      <div className="bg-popover/95 backdrop-blur-sm border border-border rounded-lg shadow-md p-2.5 text-xs z-50">
                        <div className="flex items-center gap-1.5 font-semibold text-popover-foreground mb-1">
                          <div
                            className="size-2 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          <span>{item.name}</span>
                        </div>
                        <div className="text-base font-bold font-mono text-popover-foreground">
                          {formatCurrency(item.amount, baseCurrency)}
                        </div>
                        <div className="text-[11px] text-text-muted mt-0.5">
                          {item.percent}% of gross invoiced volume
                        </div>
                        <div className="text-[10px] text-text-muted/80 mt-1 italic">
                          {item.desc}
                        </div>
                      </div>
                    )
                  }
                  return null
                }}
              />
              {/* Gross Invoiced Target Benchmark Reference Line */}
              {gross > 0 && (
                <ReferenceLine
                  x={gross}
                  stroke="#000000"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: "Gross Target",
                    position: "top",
                    fill: "#000000",
                    fontSize: 10,
                    fontWeight: 700,
                    className: "font-mono text-black",
                    style: { fill: "#000000" },
                    dy: -6,
                  }}
                />
              )}
              <Bar
                dataKey="amount"
                radius={[0, 6, 6, 0]}
                label={{
                  position: "right",
                  fill: "currentColor",
                  fontSize: 11,
                  fontWeight: 600,
                  className: "text-text-primary font-mono",
                  formatter: (v: any) => formatCurrency(v, baseCurrency),
                }}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Financial Flow KPI Cards (6 Items) */}
        <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 border-t border-border/40 pt-3">
          {/* 1. Gross Invoiced */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-[#0C2651]/5 border border-[#0C2651]/15 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-[#0C2651] shrink-0" />
              <span className="font-semibold text-text-primary">Gross:</span>
            </div>
            <span className="font-mono font-bold text-text-primary">
              {formatCurrency(gross, baseCurrency)}
            </span>
          </div>

          {/* 2. Net Income */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">Net:</span>
            </div>
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(netRetainedIncome, baseCurrency)}
            </span>
          </div>

          {/* 3. Govt Tax */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-purple-500/10 border border-purple-500/25 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-purple-500 shrink-0" />
              <span className="font-semibold text-purple-700 dark:text-purple-400">Tax:</span>
            </div>
            <span className="font-mono font-bold text-purple-600 dark:text-purple-400">
              {formatCurrency(computedInvoiceTax, baseCurrency)}
            </span>
          </div>

          {/* 4. Razorpay Deductions (Blue) */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-[#0D94FB]/10 border border-[#0D94FB]/25 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-[#0D94FB] shrink-0" />
              <span className="font-semibold text-text-primary">Razorpay:</span>
            </div>
            <span className="font-mono font-bold text-[#0D94FB]">
              {formatCurrency(computedFees, baseCurrency)}
            </span>
          </div>

          {/* 5. Missing Cash (Red) */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-rose-500 shrink-0" />
              <span className="font-semibold text-rose-700 dark:text-rose-400">Missing:</span>
            </div>
            <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
              {formatCurrency(computedUncollected, baseCurrency)}
            </span>
          </div>

          {/* 6. Unallocated Cash (Yellow) */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-amber-500 shrink-0" />
              <span className="font-semibold text-amber-700 dark:text-amber-400">Unallocated:</span>
            </div>
            <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
              {formatCurrency(computedUnallocated, baseCurrency)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
