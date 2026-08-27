"use client"

import { useMemo, useState } from "react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { moneyMovementByPeriod } from "@/data/seed"
import { ArrowDownLeftIcon, ArrowUpRightIcon } from "lucide-react"

const chartConfig = {
  moneyIn: {
    label: "Money In",
    color: "#305EFF",
  },
  moneyOut: {
    label: "Money Out",
    color: "#768EA7",
  },
} satisfies ChartConfig

type Period = keyof typeof moneyMovementByPeriod

export function MoneyMovement() {
  const [period, setPeriod] = useState<Period>("7d")
  const data = moneyMovementByPeriod[period]

  const totals = useMemo(() => {
    const inTotal = data.reduce((s, d) => s + d.moneyIn, 0)
    const outTotal = data.reduce((s, d) => s + d.moneyOut, 0)
    return { in: inTotal, out: outTotal, net: inTotal - outTotal }
  }, [data])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-semibold text-text-primary">
          Money Movement
        </CardTitle>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">7 days</SelectItem>
            <SelectItem value="30d">30 days</SelectItem>
            <SelectItem value="90d">90 days</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-surface-3 px-3 py-2.5 border border-border">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[#009E5C]/15">
              <ArrowDownLeftIcon className="size-4 text-[#009E5C]" />
            </div>
            <div>
              <p className="text-[10px] font-medium text-text-muted">Money In</p>
              <p className="text-sm font-bold tabular-nums text-[#006C3F]">
                ${totals.in.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl bg-surface-3 px-3 py-2.5 border border-border">
            <div className="flex size-8 items-center justify-center rounded-lg bg-rose-100">
              <ArrowUpRightIcon className="size-4 text-rose-600" />
            </div>
            <div>
              <p className="text-[10px] font-medium text-text-muted">Money Out</p>
              <p className="text-sm font-bold tabular-nums text-rose-700">
                ${totals.out.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Net flow */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2">
          <span className="text-xs text-text-muted">Net Flow</span>
          <span className="text-sm font-bold tabular-nums text-success">
            +${totals.net.toLocaleString()}
          </span>
        </div>

        {/* Chart */}
        <ChartContainer config={chartConfig} className="h-[180px] w-full">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -24 }}
            barGap={2}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--color-border)"
              strokeOpacity={0.6}
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickMargin={6}
              stroke="var(--color-muted-foreground)"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickMargin={4}
              stroke="var(--color-muted-foreground)"
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) =>
                    `$${Number(value).toLocaleString()}`
                  }
                />
              }
            />
            <Bar
              dataKey="moneyIn"
              fill="#305EFF"
              radius={[6, 6, 0, 0]}
              maxBarSize={24}
            />
            <Bar
              dataKey="moneyOut"
              fill="#CBD5E2"
              radius={[6, 6, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
