"use client"

import React, { useState } from "react"
import { useReconciliationStore } from "@/store/reconciliationStore"
import { updateReconcileParamsApi } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toast } from "@/hooks/use-toast"
import {
  SlidersHorizontalIcon,
  RotateCcwIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SparklesIcon,
  ShieldCheckIcon,
  CheckIcon,
  XIcon,
} from "lucide-react"

interface ParamsConfigProps {
  className?: string
  compact?: boolean
  onClose?: () => void
}

export function ParamsConfig({ className, onClose }: ParamsConfigProps) {
  const { reconcileParams, setReconcileParams } = useReconciliationStore()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)

  const handleSliderChange = (key: string, val: number | readonly number[]) => {
    const numericVal = Array.isArray(val) ? val[0] : (val as number)
    setReconcileParams({ [key]: numericVal })
  }

  const handleResetDefaults = async () => {
    const defaults = {
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
    setReconcileParams(defaults)
    try {
      await updateReconcileParamsApi(defaults)
    } catch {}
    toast({
      title: "Defaults Restored",
      description: "Matching parameters reset to default tolerances.",
    })
  }

  const handleSaveChanges = async () => {
    try {
      await updateReconcileParamsApi(reconcileParams)
      setSavedSuccess(true)
      setTimeout(() => setSavedSuccess(false), 2000)
      toast({
        title: "Parameters Saved",
        description: "Tolerances updated and ready for reconciliation.",
      })
      if (onClose) {
        setTimeout(() => onClose(), 600)
      }
    } catch (err: any) {
      toast({
        title: "Save Failed",
        description: err.message || "Failed to save parameters to server.",
        variant: "destructive",
      })
    }
  }

  const weightSum =
    (reconcileParams.weight_amount ?? 70) +
    (reconcileParams.weight_date ?? 30) +
    (reconcileParams.weight_vendor ?? 0)

  return (
    <Card className={`border-border shadow-xs ${className || ""}`}>
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 py-2.5 px-3.5">
        <div>
          <div className="flex items-center gap-1.5">
            <div className="flex size-5 items-center justify-center rounded bg-[#0D94FB]/10 text-[#0D94FB]">
              <SlidersHorizontalIcon className="size-3.5" />
            </div>
            <CardTitle className="text-xs font-bold text-text-primary">
              Matching Parameters &amp; Tolerances
            </CardTitle>
          </div>
          <CardDescription className="text-[10px] text-text-muted mt-0.5">
            Configure matching thresholds before running reconciliation
          </CardDescription>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetDefaults}
            className="h-6 text-[10px] font-medium border-border/70 hover:bg-muted/50 text-text-muted hover:text-text-primary px-2"
          >
            <RotateCcwIcon className="mr-1 size-2.5" />
            Reset Defaults
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="size-6 text-text-muted hover:text-text-primary"
              title="Collapse Parameters Panel"
            >
              <XIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-3 space-y-3">
        {/* Core Sliders 2x2 Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* 1. Date Tolerance */}
          <div className="space-y-1 rounded-lg border border-border/60 bg-surface-1/40 p-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-semibold text-text-primary">
                Date Window
              </Label>
              <Badge variant="outline" className="font-mono text-[10px] font-bold text-[#0D94FB] border-[#0D94FB]/30 bg-[#0D94FB]/5 px-1.5 py-0">
                {reconcileParams.date_tolerance_days ?? 7} day{(reconcileParams.date_tolerance_days ?? 7) !== 1 ? "s" : ""}
              </Badge>
            </div>
            <Slider
              min={0}
              max={14}
              step={1}
              value={[reconcileParams.date_tolerance_days ?? 7]}
              onValueChange={(val) => handleSliderChange("date_tolerance_days", val)}
              className="py-1"
            />
            <p className="text-[9px] text-text-muted">
              Max days between invoice &amp; deposit
            </p>
          </div>

          {/* 2. Amount Tolerance */}
          <div className="space-y-1 rounded-lg border border-border/60 bg-surface-1/40 p-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-semibold text-text-primary">
                Amount Variance
              </Label>
              <Badge variant="outline" className="font-mono text-[10px] font-bold text-[#0D94FB] border-[#0D94FB]/30 bg-[#0D94FB]/5 px-1.5 py-0">
                {reconcileParams.amount_tolerance_pct ?? 5.0}%
              </Badge>
            </div>
            <Slider
              min={0}
              max={10}
              step={0.1}
              value={[reconcileParams.amount_tolerance_pct ?? 5.0]}
              onValueChange={(val) => handleSliderChange("amount_tolerance_pct", val)}
              className="py-1"
            />
            <p className="text-[9px] text-text-muted">
              Threshold for fee/rounding diff
            </p>
          </div>

          {/* 3. Match Confidence Cutoff / Maximum Allowed Cost */}
          <div className="space-y-1 rounded-lg border border-border/60 bg-surface-1/40 p-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-semibold text-text-primary">
                Maximum Allowed Cost
              </Label>
              <Badge variant="outline" className="font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0">
                {reconcileParams.rejection_threshold ?? 0.40} max cost
              </Badge>
            </div>
            <Slider
              min={0.05}
              max={1.0}
              step={0.05}
              value={[reconcileParams.rejection_threshold ?? 0.40]}
              onValueChange={(val) => handleSliderChange("rejection_threshold", val)}
              className="py-1"
            />
            <p className="text-[9px] text-text-muted">
              Lower = Stricter, Higher = Looser (Cost &le; Cutoff)
            </p>
          </div>

          {/* 4. Strict Vendor Matching Toggle */}
          <div className="flex flex-col justify-between rounded-lg border border-border/60 bg-surface-1/40 p-2.5">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[11px] font-semibold text-text-primary block">
                  Strict Vendor Matching
                </Label>
                <p className="text-[9px] text-text-muted mt-0.5">
                  Exact vendor match requirement
                </p>
              </div>
              <Switch
                checked={reconcileParams.strict_vendor_matching ?? false}
                onCheckedChange={(checked) => setReconcileParams({ strict_vendor_matching: checked })}
              />
            </div>
            <div className="mt-1 flex items-center gap-1 pt-1 border-t border-border/40 text-[9px]">
              <ShieldCheckIcon className="size-2.5 text-[#0D94FB] shrink-0" />
              <span className="text-text-muted truncate">
                {reconcileParams.strict_vendor_matching ? "Strict mode: mismatched vendors rejected" : "Weighted penalty"}
              </span>
            </div>
          </div>
        </div>

        {/* Toggle Advanced Weights */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-[11px] font-medium text-[#0D94FB] hover:text-[#0D94FB]/80 transition-colors py-0.5 cursor-pointer"
          >
            {showAdvanced ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
            <span>{showAdvanced ? "Hide Advanced Settings" : "Advanced Weights & Split Settings"}</span>
          </button>
        </div>

        {showAdvanced && (
          <div className="pt-2 border-t border-border/60 space-y-2.5">
            {/* Algorithm Weights */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <SparklesIcon className="size-3 text-[#0D94FB]" />
                  <span className="text-[10px] font-semibold text-text-primary">Hungarian Cost Weights</span>
                </div>
                <Badge variant="outline" className="text-[9px] font-mono px-1 py-0">
                  Total: {weightSum}%
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded border border-border/50 bg-background p-1.5 space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-text-muted">Amount</span>
                    <span className="font-mono font-bold text-[#0D94FB]">{reconcileParams.weight_amount ?? 70}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[reconcileParams.weight_amount ?? 70]}
                    onValueChange={(val) => handleSliderChange("weight_amount", val)}
                    className="py-0.5"
                  />
                </div>

                <div className="rounded border border-border/50 bg-background p-1.5 space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-text-muted">Date</span>
                    <span className="font-mono font-bold text-[#0D94FB]">{reconcileParams.weight_date ?? 30}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[reconcileParams.weight_date ?? 30]}
                    onValueChange={(val) => handleSliderChange("weight_date", val)}
                    className="py-0.5"
                  />
                </div>

                <div className="rounded border border-border/50 bg-background p-1.5 space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-text-muted">Vendor</span>
                    <span className="font-mono font-bold text-[#0D94FB]">{reconcileParams.weight_vendor ?? 0}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[reconcileParams.weight_vendor ?? 0]}
                    onValueChange={(val) => handleSliderChange("weight_vendor", val)}
                    className="py-0.5"
                  />
                </div>
              </div>
            </div>

            {/* Split Settlement Subset-Sum Settings */}
            <div className="rounded-lg border border-border/60 bg-surface-1/40 p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-semibold text-text-primary">
                  Split Settlement (N:1 &amp; 1:N Subset-Sum)
                </Label>
                <Switch
                  checked={reconcileParams.allow_split ?? true}
                  onCheckedChange={(checked) => setReconcileParams({ allow_split: checked })}
                />
              </div>

              {reconcileParams.allow_split && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px]">
                      <span className="text-text-muted">Max Invoices / Batch</span>
                      <span className="font-mono font-bold text-[#0D94FB]">{reconcileParams.max_invoices_per_settlement ?? 5}</span>
                    </div>
                    <Slider
                      min={1}
                      max={6}
                      step={1}
                      value={[reconcileParams.max_invoices_per_settlement ?? 5]}
                      onValueChange={(val) => handleSliderChange("max_invoices_per_settlement", val)}
                      className="py-0.5"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px]">
                      <span className="text-text-muted">Split Tolerance</span>
                      <span className="font-mono font-bold text-[#0D94FB]">{reconcileParams.split_tolerance_pct ?? 20.0}%</span>
                    </div>
                    <Slider
                      min={0}
                      max={30}
                      step={1}
                      value={[reconcileParams.split_tolerance_pct ?? 20.0]}
                      onValueChange={(val) => handleSliderChange("split_tolerance_pct", val)}
                      className="py-0.5"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Small "Save Changes" Button following Razorpay color scheme */}
        <div className="pt-2 border-t border-border/60 flex items-center justify-end">
          <Button
            size="sm"
            onClick={handleSaveChanges}
            className="bg-[#0D94FB] hover:bg-[#0D94FB]/90 text-white font-semibold text-xs h-7.5 px-4 shadow-2xs transition-all"
          >
            {savedSuccess ? (
              <><CheckIcon className="mr-1.5 size-3.5 text-white" /> Saved!</>
            ) : (
              <><CheckIcon className="mr-1.5 size-3.5" /> Save Changes</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
