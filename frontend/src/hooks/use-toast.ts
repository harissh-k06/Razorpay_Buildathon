"use client"

import { useState, useEffect } from "react"

export interface ToastOptions {
  title?: string
  description: string
  variant?: "default" | "destructive" | "warning" | "success"
  duration?: number
}

export interface ToastItem extends ToastOptions {
  id: string
}

let toastsList: ToastItem[] = []
const listeners = new Set<(toasts: ToastItem[]) => void>()

function notify() {
  listeners.forEach((listener) => listener([...toastsList]))
}

export function toast(options: ToastOptions | string) {
  const opts: ToastOptions =
    typeof options === "string" ? { description: options } : options

  const id = Math.random().toString(36).substring(2, 9)
  const newToast: ToastItem = { ...opts, id }
  toastsList = [...toastsList, newToast]
  notify()

  const duration = opts.duration ?? 4500
  setTimeout(() => {
    toastsList = toastsList.filter((t) => t.id !== id)
    notify()
  }, duration)
}

export function dismissToast(id: string) {
  toastsList = toastsList.filter((t) => t.id !== id)
  notify()
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>(toastsList)

  useEffect(() => {
    listeners.add(setToasts)
    return () => {
      listeners.delete(setToasts)
    }
  }, [])

  return { toasts, toast, dismissToast }
}
