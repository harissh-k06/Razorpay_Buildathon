"use client"

import React from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle2Icon,
  AlertCircleIcon,
  GaugeIcon,
  FileSpreadsheetIcon,
} from "lucide-react"

interface MatchRateBarChartProps {
  matched: number
  unmatched: number
  total: number
  matchRate?: number
}

function AnimatedCounter({ value, duration = 1000 }: { value: number; duration?: number }) {
  const [count, setCount] = React.useState(0)

  React.useEffect(() => {
    let startTimestamp: number | null = null
    let frameId: number

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp
      const progress = Math.min((timestamp - startTimestamp) / duration, 1)
      const ease = 1 - Math.pow(1 - progress, 3)
      setCount(ease * value)

      if (progress < 1) {
        frameId = requestAnimationFrame(step)
      } else {
        setCount(value)
      }
    }

    frameId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameId)
  }, [value, duration])

  const formatted = count >= value - 0.05
    ? `${value}`
    : count.toFixed(1)

  return <>{formatted}%</>
}

export function MatchRateBarChart({
  matched,
  unmatched,
  total,
  matchRate,
}: MatchRateBarChartProps) {
  const safeTotal = total > 0 ? total : Math.max(matched + unmatched, 1)
  const rate = matchRate !== undefined ? matchRate : +((matched / safeTotal) * 100).toFixed(1)
  const unmatchedRate = safeTotal > 0 ? +((unmatched / safeTotal) * 100).toFixed(1) : 0

  // Trigger smooth hardware-accelerated CSS transition upon mounting / rate change
  const [isMounted, setIsMounted] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => setIsMounted(true), 60)
    return () => clearTimeout(timer)
  }, [])

  // SVG Gauge calculations (Semi-circle from 180 deg to 0 deg)
  const cx = 150
  const cy = 125
  const radius = 100
  const strokeWidth = 18
  const arcCircumference = Math.PI * radius // ~314.16

  // Visual scaling: ensure the exception zone has a clear visual slice
  const clampedRate = Math.min(Math.max(rate, 0), 100)
  const visualRate = clampedRate > 94 && clampedRate < 100 ? Math.min(clampedRate, 94.5) : clampedRate
  const progressLength = (visualRate / 100) * arcCircumference
  const needleRotationDeg = (visualRate / 100) * 180
  const needleLength = radius - 16

  return (
    <Card className="border border-border/80 bg-card shadow-xs overflow-hidden flex flex-col justify-between h-full">
      <CardHeader className="bg-surface-1/60 border-b border-border/50 text-center py-2.5 px-4">
        <div className="flex items-center justify-center gap-1.5">
          <div className="flex size-5 items-center justify-center rounded bg-[#0D94FB]/10 text-[#0D94FB]">
            <GaugeIcon className="size-3.5" />
          </div>
          <CardTitle className="text-sm font-bold text-text-primary">
            Invoice Match Rate
          </CardTitle>
        </div>
        <CardDescription className="text-[11px] text-text-muted mt-0.5">
          Executive reconciliation realization gauge: Billed customer invoices verified against gateway payouts ({matched}/{safeTotal} invoices).
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-4 pb-3.5 px-4 bg-card text-foreground flex-1 flex flex-col justify-between">
        <div className="flex flex-col items-center justify-center">
          {/* Gauge Container (Identical in dimensions to Donut Chart container) */}
          <div className="relative flex h-56 w-full max-w-sm items-center justify-center min-w-0 min-h-0">
            <svg
              viewBox="0 0 300 155"
              className="w-full h-full max-h-[180px] overflow-visible select-none mx-auto"
            >
              {/* Background Track Arc (0% - 100%) */}
              <path
                d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
                fill="none"
                stroke="#E2E8F0"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
              />

              {/* Exception Warning Zone Arc (Solid Red slice at end 95%-100%) */}
              <path
                d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
                fill="none"
                stroke="#EF4444"
                strokeWidth={strokeWidth}
                strokeDasharray={`24 ${arcCircumference}`}
                strokeDashoffset={-arcCircumference + 24}
                strokeLinecap="round"
              />

              {/* Active Matched Progress Arc (Smooth GPU animated fill) */}
              <path
                d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
                fill="none"
                stroke="#0D94FB"
                strokeWidth={strokeWidth}
                strokeDasharray={arcCircumference}
                strokeDashoffset={isMounted ? arcCircumference - progressLength : arcCircumference}
                strokeLinecap="round"
                style={{
                  transition: "stroke-dashoffset 1000ms cubic-bezier(0.16, 1, 0.3, 1)",
                  willChange: "stroke-dashoffset",
                }}
              />

              {/* Central Metric Value inside upper dome */}
              <text
                x={cx}
                y={cy - 40}
                textAnchor="middle"
                fill="#0D94FB"
                style={{
                  fill: "#0D94FB",
                  fontSize: "30px",
                  fontWeight: 800,
                  fontFamily: "ui-monospace, monospace",
                  letterSpacing: "-0.03em",
                }}
              >
                <AnimatedCounter value={rate} duration={1000} />
              </text>
              <text
                x={cx}
                y={cy - 20}
                textAnchor="middle"
                fill="#64748B"
                style={{
                  fill: "#64748B",
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                }}
              >
                MATCHED INVOICES RATE
              </text>

              {/* Needle Dial Indicator (Smooth GPU rotated around pivot) */}
              <g
                style={{
                  transform: isMounted ? `rotate(${needleRotationDeg}deg)` : "rotate(0deg)",
                  transformOrigin: `${cx}px ${cy}px`,
                  transition: "transform 1000ms cubic-bezier(0.16, 1, 0.3, 1)",
                  willChange: "transform",
                }}
              >
                {/* Needle Arrow Line (Starts at 0% / Left horizontal baseline) */}
                <line
                  x1={cx}
                  y1={cy}
                  x2={cx - needleLength}
                  y2={cy}
                  stroke="#0F172A"
                  strokeWidth="4"
                  strokeLinecap="round"
                  style={{ stroke: "#0F172A" }}
                />
                {/* Center Pivot Pin */}
                <circle cx={cx} cy={cy} r="7" fill="#0F172A" style={{ fill: "#0F172A" }} />
                <circle cx={cx} cy={cy} r="3.5" fill="#0D94FB" style={{ fill: "#0D94FB" }} />
              </g>

              {/* Scale Labels: 0% in Razorpay Blue, 100% in Red */}
              <text
                x={cx - radius - 2}
                y={cy + 18}
                textAnchor="middle"
                fill="#0D94FB"
                style={{ fill: "#0D94FB", fontSize: "11px", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}
              >
                0%
              </text>
              <text
                x={cx + radius + 2}
                y={cy + 18}
                textAnchor="middle"
                fill="#EF4444"
                style={{ fill: "#EF4444", fontSize: "11px", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}
              >
                100%
              </text>
            </svg>
          </div>

          {/* Legend Summary Badges */}
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2.5 text-xs border-t border-border/40 pt-2.5 w-full max-w-2xl">
            {/* 1. Matched Invoices (Blue) */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0D94FB]/10 border border-[#0D94FB]/25 text-[11px]">
              <div className="size-2 rounded-full bg-[#0D94FB] shrink-0" />
              <span className="font-semibold text-text-primary">Matched:</span>
              <span className="font-mono font-bold text-[#0D94FB]">{matched}</span>
              <span className="text-text-muted font-medium font-mono">({rate}%)</span>
            </div>

            {/* 2. Missing Cash Exceptions (Red) */}
            {unmatched > 0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[11px]">
                <div className="size-2 rounded-full bg-rose-500 shrink-0" />
                <span className="font-semibold text-rose-700 dark:text-rose-400">Missing Cash:</span>
                <span className="font-mono font-bold text-rose-600 dark:text-rose-400">{unmatched}</span>
                <span className="text-rose-600/80 dark:text-rose-400/80 font-medium font-mono">({unmatchedRate}%)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-border/60 text-[11px]">
                <span className="font-semibold text-text-primary">Zero Exceptions</span>
              </div>
            )}

            {/* 3. Total Billed Invoices */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-border/60 text-[11px]">
              <span className="font-semibold text-text-primary">Total:</span>
              <span className="font-mono font-bold text-text-primary">{safeTotal}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
