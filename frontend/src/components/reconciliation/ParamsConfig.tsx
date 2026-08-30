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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  SlidersHorizontalIcon,
  RotateCcwIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SparklesIcon,
  ShieldCheckIcon,
  CheckIcon,
  XIcon,
  InfoIcon,
  LayersIcon,
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
    <TooltipProvider>
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
              Configure matching thresholds and business tolerances before running reconciliation
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
          {/* Core Business Sliders 2x2 Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* 1. Date Window / Settlement Lag Tolerance */}
            <div className="space-y-1 rounded-lg border border-border/60 bg-surface-1/40 p-2.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Label className="text-[11px] font-semibold text-text-primary">
                      Date Window
                    </Label>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                            <InfoIcon className="size-3" />
                          </button>
                        }
                      />
                      <TooltipContent side="top" className="max-w-xs text-[11px] p-2 leading-relaxed">
                        <p className="font-semibold text-white mb-0.5">Settlement Lag Tolerance</p>
                        Maximum days allowed between invoice issue date and bank deposit. Payments typically take 1–7 days to clear through banking rails. Increase if payment cycles are longer.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-1">
                    {(reconcileParams.date_tolerance_days ?? 7) === 7 && (
                      <span className="text-[9px] text-text-muted hidden sm:inline">(Recommended)</span>
                    )}
                    <Badge variant="outline" className="font-mono text-[10px] font-bold text-[#0D94FB] border-[#0D94FB]/30 bg-[#0D94FB]/5 px-1.5 py-0">
                      {reconcileParams.date_tolerance_days ?? 7} day{(reconcileParams.date_tolerance_days ?? 7) !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </div>
                <Slider
                  min={0}
                  max={14}
                  step={1}
                  value={[reconcileParams.date_tolerance_days ?? 7]}
                  onValueChange={(val) => handleSliderChange("date_tolerance_days", val)}
                  className="py-1.5"
                />
              </div>
              <p className="text-[9px] text-text-muted leading-tight">
                <span className="font-medium text-text-secondary">Settlement Lag Tolerance:</span> Maximum days between invoice date and settlement deposit. Increase for longer payment cycles.
              </p>
            </div>

            {/* 2. Amount Variance / Fee & Tax Tolerance */}
            <div className="space-y-1 rounded-lg border border-border/60 bg-surface-1/40 p-2.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Label className="text-[11px] font-semibold text-text-primary">
                      Amount Variance
                    </Label>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                            <InfoIcon className="size-3" />
                          </button>
                        }
                      />
                      <TooltipContent side="top" className="max-w-xs text-[11px] p-2 leading-relaxed">
                        <p className="font-semibold text-white mb-0.5">Fee &amp; Tax Tolerance</p>
                        Maximum % difference allowed between invoiced amount and net settlement after gateway fees (1.5%–3%), taxes, and currency rounding. Increase if charges are higher.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-1">
                    {(reconcileParams.amount_tolerance_pct ?? 5.0) === 5.0 && (
                      <span className="text-[9px] text-text-muted hidden sm:inline">(Recommended)</span>
                    )}
                    <Badge variant="outline" className="font-mono text-[10px] font-bold text-[#0D94FB] border-[#0D94FB]/30 bg-[#0D94FB]/5 px-1.5 py-0">
                      {reconcileParams.amount_tolerance_pct ?? 5.0}%
                    </Badge>
                  </div>
                </div>
                <Slider
                  min={0}
                  max={10}
                  step={0.1}
                  value={[reconcileParams.amount_tolerance_pct ?? 5.0]}
                  onValueChange={(val) => handleSliderChange("amount_tolerance_pct", val)}
                  className="py-1.5"
                />
              </div>
              <p className="text-[9px] text-text-muted leading-tight">
                <span className="font-medium text-text-secondary">Fee &amp; Tax Tolerance:</span> Max % difference allowed for gateway fees, statutory tax &amp; currency rounding.
              </p>
            </div>

            {/* 3. Match Confidence Threshold */}
            <div className="space-y-1 rounded-lg border border-border/60 bg-surface-1/40 p-2.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Label className="text-[11px] font-semibold text-text-primary">
                      Match Confidence Threshold
                    </Label>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                            <InfoIcon className="size-3" />
                          </button>
                        }
                      />
                      <TooltipContent side="top" className="max-w-xs text-[11px] p-2 leading-relaxed">
                        <p className="font-semibold text-white mb-0.5">Matching Precision vs Coverage</p>
                        Controls how strictly transactions are paired. Lower (0.2) requires near-perfect matches (high precision). Higher (0.6) accepts more matches with slight variances (maximum coverage).
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0">
                    {reconcileParams.rejection_threshold ?? 0.40} cutoff
                  </Badge>
                </div>
                <Slider
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  value={[reconcileParams.rejection_threshold ?? 0.40]}
                  onValueChange={(val) => handleSliderChange("rejection_threshold", val)}
                  className="py-1.5"
                />
              </div>
              <p className="text-[9px] text-text-muted leading-tight">
                <span className="font-medium text-text-secondary">Precision vs Coverage:</span> Lower = Stricter (near-perfect matches), Higher = Looser (accepts variances). Default: 0.40.
              </p>
            </div>

            {/* 4. Require Vendor Name Match */}
            <div className="flex flex-col justify-between rounded-lg border border-border/60 bg-surface-1/40 p-2.5">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Label className="text-[11px] font-semibold text-text-primary">
                      Require Vendor Name Match
                    </Label>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                            <InfoIcon className="size-3" />
                          </button>
                        }
                      />
                      <TooltipContent side="top" className="max-w-xs text-[11px] p-2 leading-relaxed">
                        <p className="font-semibold text-white mb-0.5">Vendor Name Strictness</p>
                        When enabled, only transactions with matching vendor names are paired. Turn ON when multiple vendors have identical transaction amounts on the same day to avoid false matches.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    checked={reconcileParams.strict_vendor_matching ?? false}
                    onCheckedChange={(checked) => setReconcileParams({ strict_vendor_matching: checked })}
                  />
                </div>
                <p className="text-[9px] text-text-muted mt-1 leading-tight">
                  When enabled, only pairs with matching vendor names are accepted. Prevents false matches on identical amounts.
                </p>
              </div>
              <div className="mt-1 flex items-center gap-1 pt-1 border-t border-border/40 text-[9px]">
                <ShieldCheckIcon className="size-2.5 text-[#0D94FB] shrink-0" />
                <span className="text-text-muted truncate">
                  {reconcileParams.strict_vendor_matching ? "Strict mode: mismatched vendors rejected" : "Flexible mode: vendor differences weighted as penalty"}
                </span>
              </div>
            </div>
          </div>

          {/* Toggle Advanced Settings */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-[11px] font-medium text-[#0D94FB] hover:text-[#0D94FB]/80 transition-colors py-0.5 cursor-pointer"
            >
              {showAdvanced ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
              <span>{showAdvanced ? "Hide Advanced Settings" : "Show Advanced Settings (Matching Priority & Grouped Payments)"}</span>
            </button>
          </div>

          {showAdvanced && (
            <div className="pt-2 border-t border-border/60 space-y-2.5">
              {/* Matching Priority Weights */}
              <div className="space-y-1.5 rounded-lg border border-border/60 bg-surface-1/30 p-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <SparklesIcon className="size-3 text-[#0D94FB]" />
                    <span className="text-[11px] font-semibold text-text-primary">Matching Priority Weights</span>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                            <InfoIcon className="size-3" />
                          </button>
                        }
                      />
                      <TooltipContent side="top" className="max-w-xs text-[11px] p-2 leading-relaxed">
                        Relative importance given to amount, transaction date, and vendor name when evaluating candidate pairs. Weights must sum to 100%.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0 border-border">
                    Total: {weightSum}%
                  </Badge>
                </div>
                <p className="text-[9px] text-text-muted">
                  Configure the relative priority given to monetary value, date proximity, and vendor names.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  {/* Amount Importance */}
                  <div className="rounded border border-border/50 bg-background p-2 space-y-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <div className="flex items-center gap-0.5">
                        <span className="font-semibold text-text-primary">Amount Importance</span>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                                <InfoIcon className="size-2.5" />
                              </button>
                            }
                          />
                          <TooltipContent side="top" className="max-w-xs text-[10px] p-1.5">
                            How heavily monetary value affects matching. Higher percentage prioritises exact amount matches above all other factors.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <span className="font-mono font-bold text-[#0D94FB]">{reconcileParams.weight_amount ?? 70}%</span>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      step={5}
                      value={[reconcileParams.weight_amount ?? 70]}
                      onValueChange={(val) => handleSliderChange("weight_amount", val)}
                      className="py-1"
                    />
                    <p className="text-[8.5px] text-text-muted">Monetary value priority</p>
                  </div>

                  {/* Date Importance */}
                  <div className="rounded border border-border/50 bg-background p-2 space-y-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <div className="flex items-center gap-0.5">
                        <span className="font-semibold text-text-primary">Date Importance</span>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                                <InfoIcon className="size-2.5" />
                              </button>
                            }
                          />
                          <TooltipContent side="top" className="max-w-xs text-[10px] p-1.5">
                            How heavily transaction dates affect matching. Higher percentage prioritises transactions closer in time.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <span className="font-mono font-bold text-[#0D94FB]">{reconcileParams.weight_date ?? 30}%</span>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      step={5}
                      value={[reconcileParams.weight_date ?? 30]}
                      onValueChange={(val) => handleSliderChange("weight_date", val)}
                      className="py-1"
                    />
                    <p className="text-[8.5px] text-text-muted">Transaction date proximity</p>
                  </div>

                  {/* Vendor Importance */}
                  <div className="rounded border border-border/50 bg-background p-2 space-y-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <div className="flex items-center gap-0.5">
                        <span className="font-semibold text-text-primary">Vendor Importance</span>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                                <InfoIcon className="size-2.5" />
                              </button>
                            }
                          />
                          <TooltipContent side="top" className="max-w-xs text-[10px] p-1.5">
                            Weight for vendor name similarity. Increase when you want to prioritise matching the same vendor even if amounts or dates vary slightly.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <span className="font-mono font-bold text-[#0D94FB]">{reconcileParams.weight_vendor ?? 0}%</span>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      step={5}
                      value={[reconcileParams.weight_vendor ?? 0]}
                      onValueChange={(val) => handleSliderChange("weight_vendor", val)}
                      className="py-1"
                    />
                    <p className="text-[8.5px] text-text-muted">Vendor name similarity</p>
                  </div>
                </div>
              </div>

              {/* Grouped Payments (N:1 & 1:N Batching) */}
              <div className="rounded-lg border border-border/60 bg-surface-1/40 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <LayersIcon className="size-3.5 text-[#0D94FB]" />
                    <Label className="text-[11px] font-semibold text-text-primary">
                      Grouped Payments (N:1 &amp; 1:N Batching)
                    </Label>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                            <InfoIcon className="size-3" />
                          </button>
                        }
                      />
                      <TooltipContent side="top" className="max-w-xs text-[11px] p-2 leading-relaxed">
                        <p className="font-semibold text-white mb-0.5">Batch Settlement Matching</p>
                        Enables matching when multiple invoices are combined into a single bundled gateway settlement payout, or when one large invoice is paid across multiple split deposits.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    checked={reconcileParams.allow_split ?? true}
                    onCheckedChange={(checked) => setReconcileParams({ allow_split: checked })}
                  />
                </div>
                <p className="text-[9px] text-text-muted">
                  Match multiple invoices combined into one bundled settlement payout, or single invoices split across payouts.
                </p>

                {reconcileParams.allow_split && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1.5 border-t border-border/40">
                    {/* Max Invoices per Settlement */}
                    <div className="space-y-1 rounded border border-border/50 bg-background p-2">
                      <div className="flex justify-between items-center text-[10px]">
                        <div className="flex items-center gap-0.5">
                          <span className="font-semibold text-text-primary">Maximum Invoices per Settlement</span>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                                  <InfoIcon className="size-2.5" />
                                </button>
                              }
                            />
                            <TooltipContent side="top" className="max-w-xs text-[10px] p-1.5">
                              Limits how many individual invoices can be grouped together to match a single bundled settlement payment. Prevents over-grouping unrelated invoices.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <Badge variant="outline" className="font-mono text-[9px] font-bold text-[#0D94FB] border-[#0D94FB]/30 bg-[#0D94FB]/5 px-1 py-0">
                          {reconcileParams.max_invoices_per_settlement ?? 5} max
                        </Badge>
                      </div>
                      <Slider
                        min={1}
                        max={6}
                        step={1}
                        value={[reconcileParams.max_invoices_per_settlement ?? 5]}
                        onValueChange={(val) => handleSliderChange("max_invoices_per_settlement", val)}
                        className="py-1"
                      />
                      <p className="text-[8.5px] text-text-muted">Limits invoices grouped into a single settlement bundle</p>
                    </div>

                    {/* Grouping Deviation Allowance */}
                    <div className="space-y-1 rounded border border-border/50 bg-background p-2">
                      <div className="flex justify-between items-center text-[10px]">
                        <div className="flex items-center gap-0.5">
                          <span className="font-semibold text-text-primary">Grouping Deviation Allowance</span>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button type="button" className="text-text-muted hover:text-text-primary cursor-help">
                                  <InfoIcon className="size-2.5" />
                                </button>
                              }
                            />
                            <TooltipContent side="top" className="max-w-xs text-[10px] p-1.5">
                              Maximum percentage variance allowed when combining multiple invoices to match a single settlement (e.g. 5 invoices totaling $1,000 matching a $980 settlement).
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <Badge variant="outline" className="font-mono text-[9px] font-bold text-[#0D94FB] border-[#0D94FB]/30 bg-[#0D94FB]/5 px-1 py-0">
                          {reconcileParams.split_tolerance_pct ?? 20.0}%
                        </Badge>
                      </div>
                      <Slider
                        min={0}
                        max={30}
                        step={1}
                        value={[reconcileParams.split_tolerance_pct ?? 20.0]}
                        onValueChange={(val) => handleSliderChange("split_tolerance_pct", val)}
                        className="py-1"
                      />
                      <p className="text-[8.5px] text-text-muted">Allowed % variance for batch sum vs payout amount</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Save Changes Button */}
          <div className="pt-2 border-t border-border/60 flex items-center justify-end">
            <Button
              size="sm"
              onClick={handleSaveChanges}
              className="bg-[#0D94FB] hover:bg-[#0D94FB]/90 text-white font-semibold text-xs h-7.5 px-4 shadow-2xs transition-all cursor-pointer"
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
    </TooltipProvider>
  )
}

