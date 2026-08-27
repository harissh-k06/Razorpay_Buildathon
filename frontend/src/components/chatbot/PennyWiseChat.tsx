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
} from "lucide-react"
import { useReconciliationStore, reconciliationStore } from "@/store/reconciliationStore"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { AgenticToggle } from "./AgenticToggle"
import { fetchAgenticMode } from "@/lib/api"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

interface PennyWiseChatProps {
  onDataRefresh?: () => void
  onActionTriggered?: (action: string, target?: string) => void
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

const DEFAULT_WIDTH = 400
const DEFAULT_HEIGHT = 540
const MIN_WIDTH = 320
const MIN_HEIGHT = 380

const INITIAL_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Hello! I am PennyWise, your AI Reconciliation Assistant. I can help audit transactions, explain standardisations, resolve exceptions, or update records.",
  timestamp: new Date(),
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

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string>("")

  // Initialize unique persistent session ID for the chatbot instance
  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    }
  }, [])

  // Resizing state references
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

  // Drag Resizing Listeners
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

  // Send user message with SSE Token Streaming
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = inputMessage.trim()
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

    let accumulatedText = ""

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          session_id: sessionIdRef.current || "pennywise-frontend",
          agentic_mode: agenticMode,
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
                  onActionTriggered?.(data.action, data.target)
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new CustomEvent("pennywise:action", {
                        detail: { action: data.action, target: data.target },
                      })
                    )
                  }
                  // Immediately refresh store data
                  reconciliationStore.getState().loadData?.()
                } else if (data.token) {
                  accumulatedText += data.token
                  setStreamingText(accumulatedText)
                  setIsLoading(false) // First token chunk arrives: hide bouncing dots
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

      // Check remaining buffer
      if (buffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.slice(6).trim())
          if (data.token) {
            accumulatedText += data.token
          }
          if (data.action) {
            onActionTriggered?.(data.action, data.target)
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("pennywise:action", {
                  detail: { action: data.action, target: data.target },
                })
              )
            }
            reconciliationStore.getState().loadData?.()
          }
        } catch {}
      }

      // Push the final AI message
      if (accumulatedText.trim()) {
        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: accumulatedText,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, aiMsg])
      }
    } catch (err: any) {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error: Unable to process request (${err.message || "Network error"}). Please ensure backend and MCP servers are running.`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setStreamingText("")
      setIsLoading(false)
      // Signal immediate data refresh across all active tables
      try {
        onDataRefresh?.()
        reconciliationStore.getState().loadData?.()
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("pennywise:data_refresh"))
        }
      } catch {}
    }
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
  }

  const currentWidth = isMaximized ? "min(680px, calc(100vw - 32px))" : `${size.width}px`
  const currentHeight = isMaximized ? "min(780px, calc(100vh - 48px))" : `${size.height}px`

  return (
    <>
      {/* Floating Trigger Button: Transparent High-Res PNG without background circle */}
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
          {/* Resize Handles (Top, Left, Top-Left corner) */}
          {!isMaximized && (
            <>
              {/* Left Edge Handle */}
              <div
                onMouseDown={(e) => startResize(e, "left")}
                className="absolute left-0 top-3 bottom-3 w-2.5 -translate-x-1/2 cursor-ew-resize hover:bg-blue-500/20 active:bg-blue-500/40 rounded-full transition-colors z-60 group"
                title="Drag to resize width"
              />

              {/* Top Edge Handle */}
              <div
                onMouseDown={(e) => startResize(e, "top")}
                className="absolute top-0 left-3 right-3 h-2.5 -translate-y-1/2 cursor-ns-resize hover:bg-blue-500/20 active:bg-blue-500/40 rounded-full transition-colors z-60 group"
                title="Drag to resize height"
              />

              {/* Top-Left Corner Handle */}
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
            {/* Header: Razorpay-blue gradient */}
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
                {/* Clear Chat History Button */}
                <button
                  type="button"
                  onClick={handleClearChat}
                  className="rounded-lg p-1.5 text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
                  aria-label="Clear Chat History"
                  title="Clear Chat History"
                >
                  <RotateCcw className="size-3.5" />
                </button>

                {/* Maximize / Restore Button */}
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

                {/* Close Button */}
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

            {/* Message Body: ScrollArea */}
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
                        <div className="bg-gray-50 text-gray-800 border border-gray-100 rounded-xl rounded-tl-none px-3.5 py-2.5 text-xs sm:text-sm shadow-xs max-w-[88%] break-words">
                          <MarkdownRenderer content={msg.content} />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Loading Effect (Three Bouncing Dots) - shown while waiting for first token */}
                  {isLoading && !streamingText && (
                    <div className="flex justify-start items-start gap-2.5 mb-3">
                      <img
                        src="/penny-wise-avatar.png"
                        alt="PennyWise"
                        className="h-7 sm:h-8 w-auto object-contain shrink-0 mt-0.5 drop-shadow-xs select-none"
                      />
                      <div className="bg-gray-50 border border-gray-100 rounded-xl rounded-tl-none px-4 py-3 shadow-2xs">
                        <div className="flex space-x-1 items-center">
                          <div
                            className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                            style={{ animationDelay: "0ms" }}
                          />
                          <div
                            className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                            style={{ animationDelay: "150ms" }}
                          />
                          <div
                            className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                            style={{ animationDelay: "300ms" }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Real-time Streaming Token Bubble with typing cursor */}
                  {streamingText && (
                    <div className="flex justify-start items-start gap-2.5 mb-3">
                      <img
                        src="/penny-wise-avatar.png"
                        alt="PennyWise"
                        className="h-7 sm:h-8 w-auto object-contain shrink-0 mt-0.5 drop-shadow-xs select-none"
                      />
                      <div className="bg-gray-50 text-gray-800 border border-gray-100 rounded-xl rounded-tl-none px-3.5 py-2.5 text-xs sm:text-sm shadow-xs max-w-[88%] break-words relative">
                        <MarkdownRenderer content={streamingText} />
                        <span className="inline-block w-1.5 h-3.5 ml-1 bg-blue-500 animate-pulse align-middle rounded-xs" />
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
