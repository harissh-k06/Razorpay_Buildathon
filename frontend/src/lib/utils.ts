import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  SGD: "S$",
  AED: "د.إ",
  MYR: "RM",
  CAD: "C$",
  AUD: "A$",
  JPY: "¥",
  CNY: "元",
}

export function getCurrencySymbol(currency?: string): string {
  if (!currency) return "₹"
  const code = currency.toUpperCase().trim()
  return CURRENCY_SYMBOLS[code] || (code ? `${code} ` : "₹")
}

export function formatCurrency(
  amount: number | null | undefined,
  currency: string = "INR"
): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return "—"
  const num = Number(amount)
  const code = (currency || "INR").toUpperCase().trim()
  const symbol = CURRENCY_SYMBOLS[code] || (code ? `${code} ` : "₹")
  const locale = code === "INR" ? "en-IN" : "en-US"
  return `${symbol}${num.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
