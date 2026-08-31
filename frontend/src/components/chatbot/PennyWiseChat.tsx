"use client"

import React, { useState, useEffect, useRef } from "react"
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Bot,
  Send,
  X,
  Maximize2,
  Minimize2,
  RotateCcw,
  MailIcon,
  EditIcon,
  SendIcon,
  CheckCircleIcon,
  XCircleIcon,
  Loader2Icon,
} from "lucide-react"
import { useReconciliationStore, reconciliationStore } from "@/store/reconciliationStore"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { AgenticToggle } from "./AgenticToggle"
import { fetchAgenticMode, getApiBaseUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  emailDraft?: EmailDraft | null
  emailDrafts?: EmailDraft[]
}

interface EmailDraft {
  subject: string
  body: string
  to: string
  vendor?: string
  exceptionIds?: string[]
  totalAmount?: number
}

interface PennyWiseChatProps {
  onDataRefresh?: () => void
  onActionTriggered?: (action: string, target?: string) => void
}

const API_BASE_URL = getApiBaseUrl()

const DEFAULT_WIDTH = 400
const DEFAULT_HEIGHT = 540
const MIN_WIDTH = 320
const MIN_HEIGHT = 380

const INITIAL_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Hello! I am PennyWise, your AI Reconciliation Assistant. I can help audit transactions, explain standardisations, resolve exceptions, draft memos, and send emails to vendors.",
  timestamp: new Date(),
}

// ── EmailDraftCard – inline email review & send component ─────────────────────
function EmailDraftCard({
  draft,
  agenticMode = true,
  onSent,
  onCancel,
}: {
  draft: EmailDraft
  agenticMode?: boolean
  onSent: (recipient: string, exceptionIds?: string[]) => void
  onCancel: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editSubject, setEditSubject] = useState(draft.subject)
  const [editBody, setEditBody] = useState(draft.body)
  const [isSending, setIsSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  const handleSend = async () => {
    if (!agenticMode) {
      setError("Please switch Agentic Mode ON (green toggle) to send resolution emails.")
      return
    }
    setIsSending(true)
    setError("")
    try {
      const resp = await fetch(`${API_BASE_URL}/api/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          to: draft.to,
          subject: editSubject,
          body: editBody,
        }),
      })
      const data = await resp.json()
      if (!resp.ok || !data.success) {
        throw new Error(data.detail || data.error || "Failed to send email")
      }
      setSent(true)

      // Automatically mark exception(s) as resolved after email is sent
      const targetIds = draft.exceptionIds && draft.exceptionIds.length > 0
        ? draft.exceptionIds
        : []

      if (targetIds.length > 0) {
        const resolutionNote = `Email sent to ${draft.to} via PennyWise. Subject: ${editSubject}`
        try {
          await reconciliationStore.getState().resolveExceptions(
            targetIds,
            "manual",
            resolutionNote
          )
        } catch (resolveErr) {
          console.warn("Direct store resolve error:", resolveErr)
        }

        try {
          await fetch(`${API_BASE_URL}/api/resolve-exceptions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              exception_ids: targetIds,
              mode: "manual",
              resolution_note: resolutionNote,
            }),
          })
        } catch (apiErr) {
          console.warn("API resolve error:", apiErr)
        }

        reconciliationStore.getState().loadData?.()
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("pennywise:data_refresh"))
        }
      }

      toast({
        title: "Email Sent & Exception Resolved!",
        description: `Email delivered to ${draft.to}. Record marked as Resolved.`,
        variant: "success" as any,
      })
      onSent(draft.to, draft.exceptionIds)
    } catch (e: any) {
      setError(e.message || "Failed to send email. Please ensure you are logged in with Google.")
    } finally {
      setIsSending(false)
    }
  }

  if (sent) {
    return (
      <div className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <CheckCircleIcon className="size-4" />
          <span className="font-semibold">Email sent successfully to {draft.to}{draft.vendor ? ` (${draft.vendor})` : ""}!</span>
        </div>
        <p className="mt-1 text-text-muted">
          {draft.exceptionIds && draft.exceptionIds.length > 0
            ? `The referenced exception(s) (${draft.exceptionIds.join(", ")}) have been marked as Resolved.`
            : "The exception has been automatically marked as Resolved and moved to the Resolved tab."}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-xl border border-[#0D94FB]/30 bg-[#0D94FB]/5 overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#0D94FB]/20 bg-[#0D94FB]/10">
        <div className="flex items-center gap-1.5 font-semibold text-[#0D94FB]">
          <MailIcon className="size-3.5" />
          <span>Email Draft Ready {draft.vendor ? `• ${draft.vendor}` : ""}</span>
          {draft.exceptionIds && draft.exceptionIds.length > 0 && (
            <span className="text-[10px] font-normal text-text-muted ml-1">
              ({draft.exceptionIds.join(", ")})
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium bg-white/60 hover:bg-white text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            <EditIcon className="size-3" />
            {isEditing ? "Done" : "Edit"}
          </button>
        </div>
      </div>

      {/* Email meta */}
      <div className="px-3 py-2 space-y-1.5 border-b border-[#0D94FB]/15">
        <div className="flex items-start gap-1.5">
          <span className="shrink-0 text-[10px] font-semibold text-text-muted uppercase w-12">To:</span>
          <span className="font-mono text-[11px] text-text-primary">{draft.to}</span>
        </div>
        {draft.vendor && (
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 text-[10px] font-semibold text-text-muted uppercase w-12">Vendor:</span>
            <span className="text-[11px] font-medium text-text-primary">{draft.vendor}</span>
          </div>
        )}
        <div className="flex items-start gap-1.5">
          <span className="shrink-0 text-[10px] font-semibold text-text-muted uppercase w-12">Subject:</span>
          {isEditing ? (
            <input
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              className="flex-1 text-[11px] bg-white border border-[#0D94FB]/30 rounded px-2 py-0.5 font-medium text-text-primary focus:outline-none focus:ring-1 focus:ring-[#0D94FB]"
            />
          ) : (
            <span className="text-[11px] font-medium text-text-primary">{editSubject}</span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2 max-h-48 overflow-y-auto">
        {isEditing ? (
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={8}
            className="w-full text-[11px] bg-white border border-[#0D94FB]/30 rounded px-2 py-1.5 font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-[#0D94FB] resize-none leading-relaxed"
          />
        ) : (
          <pre className="whitespace-pre-wrap text-[11px] text-text-secondary font-sans leading-relaxed">
            {editBody}
          </pre>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 flex items-center gap-1.5 rounded-lg bg-destructive/10 border border-destructive/20 p-2 text-[11px] text-destructive">
          <XCircleIcon className="size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[#0D94FB]/15 bg-[#0D94FB]/5">
        <span className="text-[10px] text-text-muted">
          {draft.exceptionIds?.length ? `Resolves: ${draft.exceptionIds.join(", ")}` : "Sends via Gmail"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="text-[11px] text-text-muted hover:text-text-primary px-2 py-1 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={isSending}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-[11px] font-semibold px-3 py-1.5 transition-colors cursor-pointer"
          >
            {isSending ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <SendIcon className="size-3" />
            )}
            {isSending ? "Sending…" : `Send ${draft.vendor ? `${draft.vendor} ` : ""}Email`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Extract email drafts from assistant message (Supports Multi-Vendor) ─────────
function extractEmailDrafts(
  content: string,
  recipient?: string,
  fallbackExceptionIds?: string[] | string
): EmailDraft[] {
  const fallbackList = Array.isArray(fallbackExceptionIds)
    ? fallbackExceptionIds
    : fallbackExceptionIds
    ? [fallbackExceptionIds]
    : undefined

  const results: EmailDraft[] = []
  const seenKeys = new Set<string>()

  const addDraft = (item: any) => {
    if (!item || !item.subject || !item.body) return
    const to = item.to || recipient || ""
    const eIds = Array.isArray(item.exception_ids)
      ? item.exception_ids
      : typeof item.exception_ids === "string"
      ? [item.exception_ids]
      : fallbackList

    const key = `${item.subject}__${to}__${(eIds || []).join(",")}`
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      results.push({
        subject: item.subject,
        body: item.body,
        to,
        vendor: item.vendor,
        exceptionIds: eIds,
        totalAmount: item.total_amount,
      })
    }
  }

  // 1. Look for all ```json ... ``` code blocks
  const jsonRegex = /```json\s*([\s\S]*?)\s*```/gi
  let match: RegExpExecArray | null
  while ((match = jsonRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (Array.isArray(parsed)) {
        for (const it of parsed) addDraft(it)
      } else if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.emails)) {
          for (const it of parsed.emails) addDraft(it)
        } else {
          addDraft(parsed)
        }
      }
    } catch {}
  }

  if (results.length > 0) {
    return results
  }

  // 2. Look for raw JSON objects in text { "subject": ..., "body": ... }
  const rawJsonRegex = /\{[\s\r\n]*"(?:to|subject|body|vendor)"[\s\S]*?\}/g
  while ((match = rawJsonRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[0])
      addDraft(parsed)
    } catch {}
  }

  if (results.length > 0) {
    return results
  }

  // 3. Fallback: Look for structured text markers: Subject:, To:, Body starting with Hi/Dear/Hello
  const subjectMatch = content.match(/(?:\*\*Subject:\*\*|Subject:|SUBJECT:)\s*(.+?)(?:\n|$)/i)
  const toMatch = content.match(/(?:\*\*To:\*\*|To:|TO:)\s*([^\s@\n]+@[^\s@\n]+\.[^\s@\n]+)/i)

  const to = toMatch?.[1]?.trim() || recipient
  const subject = subjectMatch?.[1]?.replace(/^\*+|\*+$/g, "").trim()

  if (subject && to) {
    const greetingIdx = content.search(/(?:Dear|Hi|Hello|Hey)\s+/i)
    if (greetingIdx !== -1) {
      const bodyPart = content.slice(greetingIdx).split(/\n---\n/)[0].trim()
      if (bodyPart.length > 30) {
        results.push({
          subject,
          body: bodyPart,
          to,
          exceptionIds: fallbackList,
        })
      }
    }
  }

  return results
}


export function PennyWiseChat({ onDataRefresh, onActionTriggered }: PennyWiseChatProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const [inputMessage, setInputMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [streamingText, setStreamingText] = useState("")
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE])
  const agenticMode = useReconciliationStore((state) => state.agenticMode)

  // Track pending email context (recipient from ResolveDialog)
  const pendingEmailRecipientRef = useRef<string | null>(null)
  const pendingExceptionIdsRef = useRef<string[]>([])

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string>("")

  // ── Smooth Adaptive Streaming Typewriter Engine ──
  const streamTargetRef = useRef<string>("")
  const streamDisplayRef = useRef<string>("")
  const streamAnimTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isStreamActiveRef = useRef<boolean>(false)

  const startStreamAnimation = () => {
    if (streamAnimTimerRef.current) return
    streamAnimTimerRef.current = setInterval(() => {
      const target = streamTargetRef.current
      const current = streamDisplayRef.current
      const remaining = target.length - current.length

      if (remaining > 0) {
        // Natural human/AI typewriter velocity with adaptive burst catchup
        let step = 1
        if (remaining > 120) {
          step = Math.ceil(remaining / 6)
        } else if (remaining > 60) {
          step = 4
        } else if (remaining > 25) {
          step = 3
        } else if (remaining > 8) {
          step = 2
        } else {
          step = 1
        }

        const next = target.slice(0, current.length + step)
        streamDisplayRef.current = next
        setStreamingText(next)
        setIsLoading(false)
      } else if (!isStreamActiveRef.current && remaining === 0) {
        stopStreamAnimation()
      }
    }, 16)
  }

  const stopStreamAnimation = () => {
    if (streamAnimTimerRef.current) {
      clearInterval(streamAnimTimerRef.current)
      streamAnimTimerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      stopStreamAnimation()
    }
  }, [])

  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    }
  }, [])

  const isDraggingRef = useRef<null | "left" | "top" | "top-left">(null)
  const startPosRef = useRef({ x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    if (isOpen) {
      scrollToBottom()
    }
  }, [messages, isLoading, streamingText, isOpen])

  const startResize = (e: React.MouseEvent, direction: "left" | "top" | "top-left") => {
    e.preventDefault()
    e.stopPropagation()
    if (isMaximized) return

    isDraggingRef.current = direction
    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    }

    document.body.style.userSelect = "none"
    document.body.style.cursor =
      direction === "top-left"
        ? "nwse-resize"
        : direction === "left"
        ? "ew-resize"
        : "ns-resize"
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const dir = isDraggingRef.current
      const deltaX = startPosRef.current.x - e.clientX
      const deltaY = startPosRef.current.y - e.clientY

      const maxWidth = Math.min(850, window.innerWidth - 32)
      const maxHeight = Math.min(850, window.innerHeight - 32)

      let newWidth = startPosRef.current.width
      let newHeight = startPosRef.current.height

      if (dir === "left" || dir === "top-left") {
        newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, startPosRef.current.width + deltaX))
      }
      if (dir === "top" || dir === "top-left") {
        newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, startPosRef.current.height + deltaY))
      }

      setSize({ width: newWidth, height: newHeight })
    }

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = null
        document.body.style.userSelect = ""
        document.body.style.cursor = ""
      }
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [])

  useEffect(() => {
    const handleOpenWithPrompt = (e: any) => {
      setIsOpen(true)
      if (e.detail?.prompt) {
        setInputMessage(e.detail.prompt)
      }
    }

    const handleOpenAndSend = (e: any) => {
      setIsOpen(true)
      // Capture email context if present
      if (e.detail?.action === "email" && e.detail?.recipient) {
        pendingEmailRecipientRef.current = e.detail.recipient
        const ids = e.detail.exceptionIds || (e.detail.exceptionId ? [e.detail.exceptionId] : [])
        pendingExceptionIdsRef.current = ids
      } else {
        pendingEmailRecipientRef.current = null
        pendingExceptionIdsRef.current = []
      }
      if (e.detail?.prompt) {
        executeSendMessage(e.detail.prompt)
      }
    }

    window.addEventListener("pennywise:open_with_prompt" as any, handleOpenWithPrompt)
    window.addEventListener("pennywise:open_and_send" as any, handleOpenAndSend)

    return () => {
      window.removeEventListener("pennywise:open_with_prompt" as any, handleOpenWithPrompt)
      window.removeEventListener("pennywise:open_and_send" as any, handleOpenAndSend)
    }
  }, [agenticMode])

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    executeSendMessage(inputMessage)
  }

  const executeSendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim()
    if (!trimmed || isLoading || streamingText) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMsg])
    setInputMessage("")
    setIsLoading(true)
    setStreamingText("")

    streamTargetRef.current = ""
    streamDisplayRef.current = ""
    isStreamActiveRef.current = true

    let accumulatedText = ""
    const capturedRecipient = pendingEmailRecipientRef.current
    const capturedExceptionIds = [...pendingExceptionIdsRef.current]

    try {
      // Pass up to last 10 turns (5 user + 5 assistant)
      const recentHistory = messages
        .filter((m) => m.id !== "welcome" && m.content)
        .slice(-10)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }))

      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: trimmed,
          session_id: sessionIdRef.current || "pennywise-frontend",
          agentic_mode: agenticMode,
          history: recentHistory,
        }),
      })

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`)
      }
      if (!response.body) {
        throw new Error("No response body received")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split("\n\n")
        buffer = events.pop() || ""

        for (const event of events) {
          const lines = event.split("\n")
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim()
              if (!dataStr) continue
              try {
                const data = JSON.parse(dataStr)
                if (data.action) {
                  setIsLoading(false)
                  if (data.action === "update_params") {
                    const newParams = data.params || (typeof data.target === "object" ? data.target : null)
                    if (newParams) {
                      reconciliationStore.getState().setReconcileParams?.(newParams)
                    }
                  }
                  onActionTriggered?.(data.action, data.target)
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new CustomEvent("pennywise:action", {
                        detail: { action: data.action, target: data.target, params: data.params },
                      })
                    )
                    window.dispatchEvent(
                      new CustomEvent("pennywise:data_refresh", {
                        detail: { action: data.action, target: data.target, params: data.params },
                      })
                    )
                  }
                  reconciliationStore.getState().loadData?.()
                } else if (data.token) {
                  accumulatedText += data.token
                  streamTargetRef.current = accumulatedText
                  startStreamAnimation()
                } else if (data.error) {
                  throw new Error(data.error)
                }
              } catch {
                // Ignore parse errors on partial chunks
              }
            }
          }
        }
      }

      if (buffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.slice(6).trim())
          if (data.token) {
            accumulatedText += data.token
            streamTargetRef.current = accumulatedText
            startStreamAnimation()
          }
          if (data.action) {
            if (data.action === "update_params") {
              const newParams = data.params || (typeof data.target === "object" ? data.target : null)
              if (newParams) {
                reconciliationStore.getState().setReconcileParams?.(newParams)
              }
            }
            onActionTriggered?.(data.action, data.target)
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("pennywise:action", {
                  detail: { action: data.action, target: data.target, params: data.params },
                })
              )
              window.dispatchEvent(
                new CustomEvent("pennywise:data_refresh", {
                  detail: { action: data.action, target: data.target, params: data.params },
                })
              )
            }
            reconciliationStore.getState().loadData?.()
          }
        } catch {}
      }

      // Mark stream network done and smoothly wait for typewriter buffer to finish typing
      isStreamActiveRef.current = false
      if (accumulatedText && streamDisplayRef.current.length < streamTargetRef.current.length) {
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            if (streamDisplayRef.current.length >= streamTargetRef.current.length) {
              clearInterval(checkInterval)
              resolve()
            }
          }, 16)
          setTimeout(() => {
            clearInterval(checkInterval)
            resolve()
          }, 2500)
        })
      }
      stopStreamAnimation()

      // Try to extract email drafts if this was an email request or model generated emails
      if (accumulatedText) {
        const fallbackRecipient = capturedRecipient || pendingEmailRecipientRef.current || undefined
        const fallbackIds = (capturedExceptionIds && capturedExceptionIds.length > 0)
          ? capturedExceptionIds
          : (pendingExceptionIdsRef.current && pendingExceptionIdsRef.current.length > 0)
          ? pendingExceptionIdsRef.current
          : undefined
        const emailDrafts = extractEmailDrafts(accumulatedText, fallbackRecipient, fallbackIds)

        if (emailDrafts.length > 0) {
          pendingEmailRecipientRef.current = null
          pendingExceptionIdsRef.current = []
        }

        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: accumulatedText,
          timestamp: new Date(),
          emailDraft: emailDrafts[0] || null,
          emailDrafts: emailDrafts,
        }
        setMessages((prev) => [...prev, aiMsg])
      }
    } catch (err: any) {
      stopStreamAnimation()
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error: Unable to process request (${err.message || "Network error"}). Please ensure backend and MCP servers are running.`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      stopStreamAnimation()
      setStreamingText("")
      setIsLoading(false)
      try {
        onDataRefresh?.()
        reconciliationStore.getState().loadData?.()
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("pennywise:data_refresh"))
        }
      } catch {}
    }
  }

  const handleEmailSent = (recipient: string, exceptionIds?: string[]) => {
    const idStr = exceptionIds && exceptionIds.length > 0 ? ` for (${exceptionIds.join(", ")})` : ""
    const confirmMsg: Message = {
      id: Date.now().toString(),
      role: "assistant",
      content: `✅ **Email successfully sent to ${recipient}${idStr}!**\n\nThe exception record(s) have been marked as **Resolved** and moved to the Resolved tab. The reconciliation dashboard will update shortly.`,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, confirmMsg])
  }

  const handleEmailCancelled = (msgId: string, draftIdx?: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m
        const currentDrafts = m.emailDrafts || (m.emailDraft ? [m.emailDraft] : [])
        if (draftIdx !== undefined) {
          const updated = currentDrafts.filter((_, i) => i !== draftIdx)
          return { ...m, emailDrafts: updated, emailDraft: updated[0] || null }
        }
        return { ...m, emailDrafts: [], emailDraft: null }
      })
    )
  }

  const handleClearChat = async () => {
    try {
      if (sessionIdRef.current) {
        await fetch(`${API_BASE_URL}/api/chat/clear`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionIdRef.current }),
        })
      }
    } catch (e) {
      console.warn("Failed to clear backend chat session:", e)
    }
    setMessages([
      {
        ...INITIAL_MESSAGE,
        timestamp: new Date(),
      },
    ])
    setStreamingText("")
    setIsLoading(false)
    pendingEmailRecipientRef.current = null
    pendingExceptionIdsRef.current = []
  }

  const currentWidth = isMaximized ? "min(680px, calc(100vw - 32px))" : `${size.width}px`
  const currentHeight = isMaximized ? "min(780px, calc(100vh - 48px))" : `${size.height}px`

  return (
    <>
      {/* Floating Trigger Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center justify-center p-0 bg-transparent border-0 outline-none hover:scale-110 active:scale-95 transition-all duration-300 group cursor-pointer focus:outline-none"
          aria-label="Open PennyWise AI Assistant"
        >
          <img
            src="/penny-wise-avatar.png"
            alt="PennyWise AI"
            className="h-16 sm:h-20 w-auto object-contain drop-shadow-[0_10px_20px_rgba(13,148,251,0.35)] group-hover:drop-shadow-[0_15px_25px_rgba(13,148,251,0.55)] group-hover:rotate-3 transition-all duration-300"
          />
          <span className="absolute top-0.5 right-0.5 flex size-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full size-3.5 bg-blue-500 border-2 border-white shadow-xs"></span>
          </span>
        </button>
      )}

      {/* Floating Resizable Chatbot Window */}
      {isOpen && (
        <div
          style={{ width: currentWidth, height: currentHeight }}
          className="fixed bottom-6 right-6 z-50 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 transition-[width,height] select-text"
        >
          {/* Resize Handles */}
          {!isMaximized && (
            <>
              <div
                onMouseDown={(e) => startResize(e, "left")}
                className="absolute left-0 top-3 bottom-3 w-2.5 -translate-x-1/2 cursor-ew-resize hover:bg-blue-500/20 active:bg-blue-500/40 rounded-full transition-colors z-60 group"
                title="Drag to resize width"
              />
              <div
                onMouseDown={(e) => startResize(e, "top")}
                className="absolute top-0 left-3 right-3 h-2.5 -translate-y-1/2 cursor-ns-resize hover:bg-blue-500/20 active:bg-blue-500/40 rounded-full transition-colors z-60 group"
                title="Drag to resize height"
              />
              <div
                onMouseDown={(e) => startResize(e, "top-left")}
                className="absolute -top-1 -left-1 size-5 cursor-nwse-resize hover:bg-blue-500/30 active:bg-blue-500/50 rounded-full transition-all z-60 flex items-center justify-center group"
                title="Drag to resize width and height"
              >
                <div className="size-2 rounded-full bg-blue-400 opacity-60 group-hover:opacity-100 group-hover:scale-125 transition-all" />
              </div>
            </>
          )}

          <Card className="bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden flex flex-col h-full w-full p-0 gap-0 relative">
            {/* Header */}
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-white flex flex-row items-center justify-between border-b border-blue-400/30 rounded-t-2xl space-y-0 shrink-0">
              <div className="flex items-center gap-2.5">
                <img
                  src="/penny-wise-avatar.png"
                  alt="PennyWise"
                  className="h-8.5 w-auto object-contain shrink-0 drop-shadow-xs"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white text-sm font-semibold tracking-tight">
                      PennyWise
                    </span>
                    <Badge className="bg-white/20 hover:bg-white/25 text-white border-0 text-[10px] px-1.5 py-0 h-4 font-semibold">
                      AI
                    </Badge>
                  </div>
                  <p className="text-[11px] text-blue-100 font-normal">
                    Reconciliation Assistant
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleClearChat}
                  className="rounded-lg p-1.5 text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
                  aria-label="Clear Chat History"
                  title="Clear Chat History"
                >
                  <RotateCcw className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsMaximized((prev) => !prev)}
                  className="rounded-lg p-1.5 text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
                  aria-label={isMaximized ? "Restore Size" : "Maximize Chat"}
                  title={isMaximized ? "Restore Size" : "Maximize Chat"}
                >
                  {isMaximized ? (
                    <Minimize2 className="size-3.5" />
                  ) : (
                    <Maximize2 className="size-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg p-1.5 text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
                  aria-label="Close Chat"
                  title="Close Chat"
                >
                  <X className="size-4" />
                </button>
              </div>
            </CardHeader>

            {/* Message Body */}
            <CardContent className="flex-1 p-3 bg-white overflow-hidden flex flex-col min-h-0">
              <ScrollArea className="flex-1 pr-2.5 h-full">
                <div className="space-y-3.5 pt-1">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex w-full gap-2 items-start",
                        msg.role === "user" ? "justify-end" : "justify-start"
                      )}
                    >
                      {msg.role === "assistant" && (
                        <img
                          src="/penny-wise-avatar.png"
                          alt="PennyWise"
                          className="h-7 sm:h-8 w-auto object-contain shrink-0 mt-0.5 drop-shadow-xs select-none"
                        />
                      )}
                      {msg.role === "user" ? (
                        <div className="bg-blue-600 text-white rounded-xl rounded-br-none px-3.5 py-2 text-xs sm:text-sm shadow-xs max-w-[85%] break-words">
                          {msg.content}
                        </div>
                      ) : (
                        <div className="max-w-[88%] w-full">
                          <div className="bg-gray-50 text-gray-800 border border-gray-100 rounded-xl rounded-tl-none px-3.5 py-2.5 text-xs sm:text-sm shadow-xs break-words">
                            <MarkdownRenderer content={msg.content} />
                          </div>
                          {/* Email Draft Cards */}
                          {msg.emailDrafts && msg.emailDrafts.length > 0 ? (
                            <div className="space-y-2 mt-2">
                              {msg.emailDrafts.map((draft, draftIdx) => (
                                <EmailDraftCard
                                  key={`${msg.id}-draft-${draftIdx}-${draft.vendor || draftIdx}`}
                                  draft={draft}
                                  agenticMode={agenticMode}
                                  onSent={handleEmailSent}
                                  onCancel={() => handleEmailCancelled(msg.id, draftIdx)}
                                />
                              ))}
                            </div>
                          ) : msg.emailDraft ? (
                            <EmailDraftCard
                              draft={msg.emailDraft}
                              agenticMode={agenticMode}
                              onSent={handleEmailSent}
                              onCancel={() => handleEmailCancelled(msg.id)}
                            />
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Loading dots */}
                  {isLoading && !streamingText && (
                    <div className="flex justify-start items-start gap-2.5 mb-3">
                      <img
                        src="/penny-wise-avatar.png"
                        alt="PennyWise"
                        className="h-7 sm:h-8 w-auto object-contain shrink-0 mt-0.5 drop-shadow-xs select-none"
                      />
                      <div className="bg-gray-50 border border-gray-100 rounded-xl rounded-tl-none px-4 py-3 shadow-2xs">
                        <div className="flex space-x-1 items-center">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Streaming bubble */}
                  {streamingText && (
                    <div className="flex justify-start items-start gap-2.5 mb-3 transition-all duration-150 animate-in fade-in-50">
                      <img
                        src="/penny-wise-avatar.png"
                        alt="PennyWise"
                        className="h-7 sm:h-8 w-auto object-contain shrink-0 mt-0.5 drop-shadow-xs select-none"
                      />
                      <div className="bg-gray-50 text-gray-800 border border-gray-200/80 rounded-xl rounded-tl-none px-3.5 py-2.5 text-xs sm:text-sm shadow-xs max-w-[88%] break-words relative leading-relaxed">
                        <MarkdownRenderer content={streamingText} />
                        <span className="inline-block w-1.5 h-3.5 ml-1 bg-[#0D94FB] animate-pulse align-middle rounded-xs shadow-[0_0_8px_rgba(13,148,251,0.6)]" />
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </CardContent>

            {/* Footer Input */}
            <CardFooter className="p-3 bg-gray-50/70 border-t border-gray-100 rounded-b-2xl shrink-0">
              <form
                onSubmit={handleSendMessage}
                className="flex items-center gap-2 w-full"
              >
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Ask PennyWise to audit or edit records..."
                  disabled={isLoading || !!streamingText}
                  className="bg-white border-gray-200 focus:border-blue-500 focus-visible:ring-blue-500 text-xs sm:text-sm h-9 rounded-lg"
                />
                <AgenticToggle />
                <Button
                  type="submit"
                  disabled={isLoading || !!streamingText || !inputMessage.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 size-9 p-0 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                  aria-label="Send Message"
                >
                  <Send className="size-4" />
                </Button>
              </form>
            </CardFooter>
          </Card>
        </div>
      )}
    </>
  )
}
