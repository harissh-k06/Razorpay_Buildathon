"use client"

import React, { useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  if (!content) return null

  // Split into blocks: code blocks, tables, lists, headings, blockquotes, paragraphs
  const blocks = parseMarkdownBlocks(content)

  return (
    <div className={cn("space-y-2 text-xs sm:text-sm leading-relaxed text-gray-800", className)}>
      {blocks.map((block, idx) => (
        <React.Fragment key={idx}>{renderBlock(block, idx)}</React.Fragment>
      ))}
    </div>
  )
}

type BlockType =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; language: string; code: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "paragraph"; text: string }

function parseMarkdownBlocks(raw: string): BlockType[] {
  const lines = raw.split("\n")
  const blocks: BlockType[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Empty lines
    if (!trimmed) {
      i++
      continue
    }

    // Fenced Code Block
    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim() || "text"
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // skip closing ```
      blocks.push({
        type: "code",
        language,
        code: codeLines.join("\n"),
      })
      continue
    }

    // Markdown Table
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && i + 1 < lines.length) {
      const nextLineTrimmed = lines[i + 1].trim()
      if (
        nextLineTrimmed.startsWith("|") &&
        nextLineTrimmed.includes("-") &&
        nextLineTrimmed.endsWith("|")
      ) {
        // Table detected
        const headerCells = parseTableRow(trimmed)
        i += 2 // skip header and delimiter row
        const tableRows: string[][] = []

        while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
          tableRows.push(parseTableRow(lines[i].trim()))
          i++
        }

        blocks.push({
          type: "table",
          headers: headerCells,
          rows: tableRows,
        })
        continue
      }
    }

    // Headings (#, ##, ###, ####)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2],
      })
      i++
      continue
    }

    // Horizontal rule (--- or ***)
    if (/^(---|---|\*\*\*)$/.test(trimmed)) {
      blocks.push({ type: "hr" })
      i++
      continue
    }

    // Blockquote (> )
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""))
        i++
      }
      blocks.push({
        type: "quote",
        text: quoteLines.join("\n"),
      })
      continue
    }

    // Unordered List (- or * or +)
    if (/^[-*+]\s+/.test(trimmed)) {
      const listItems: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^[-*+]\s+/, ""))
        i++
      }
      blocks.push({
        type: "list",
        ordered: false,
        items: listItems,
      })
      continue
    }

    // Ordered List (1. 2. etc)
    if (/^\d+\.\s+/.test(trimmed)) {
      const listItems: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^\d+\.\s+/, ""))
        i++
      }
      blocks.push({
        type: "list",
        ordered: true,
        items: listItems,
      })
      continue
    }

    // Regular Paragraph (combine contiguous non-special lines)
    const paraLines: string[] = [trimmed]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith(">") &&
      !lines[i].trim().startsWith("|") &&
      !/^[-*+]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^(---|---|\*\*\*)$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim())
      i++
    }

    blocks.push({
      type: "paragraph",
      text: paraLines.join(" "),
    })
  }

  return blocks
}

function parseTableRow(line: string): string[] {
  // Remove leading and trailing pipe and split
  const rawCells = line.slice(1, -1).split("|")
  return rawCells.map((c) => c.trim())
}

function renderBlock(block: BlockType, key: number) {
  switch (block.type) {
    case "heading": {
      const { level, text } = block
      if (level === 1) {
        return (
          <h1 key={key} className="text-base font-bold text-gray-900 mt-2 mb-1 border-b border-gray-200 pb-1">
            {renderInlineMarkdown(text)}
          </h1>
        )
      }
      if (level === 2) {
        return (
          <h2 key={key} className="text-sm font-bold text-gray-900 mt-2 mb-1">
            {renderInlineMarkdown(text)}
          </h2>
        )
      }
      if (level === 3) {
        return (
          <h3 key={key} className="text-xs sm:text-sm font-semibold text-blue-900 mt-1.5 mb-0.5">
            {renderInlineMarkdown(text)}
          </h3>
        )
      }
      return (
        <h4 key={key} className="text-xs font-semibold text-gray-800 mt-1 mb-0.5">
          {renderInlineMarkdown(text)}
        </h4>
      )
    }

    case "code": {
      return <CodeBlock key={key} language={block.language} code={block.code} />
    }

    case "table": {
      return (
        <div key={key} className="my-2 w-full overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-2xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-gray-100 text-gray-700 font-semibold border-b border-gray-200">
              <tr>
                {block.headers.map((h, hIdx) => (
                  <th key={hIdx} className="px-2.5 py-1.5 whitespace-nowrap">
                    {renderInlineMarkdown(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {block.rows.map((row, rIdx) => (
                <tr key={rIdx} className={rIdx % 2 === 1 ? "bg-gray-50/50" : "bg-white"}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-2.5 py-1.5 whitespace-nowrap">
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    case "list": {
      if (block.ordered) {
        return (
          <ol key={key} className="my-1.5 list-decimal list-outside pl-5 space-y-1">
            {block.items.map((item, idx) => (
              <li key={idx} className="text-xs sm:text-sm text-gray-800">
                {renderInlineMarkdown(item)}
              </li>
            ))}
          </ol>
        )
      }
      return (
        <ul key={key} className="my-1.5 list-disc list-outside pl-4 space-y-1">
          {block.items.map((item, idx) => (
            <li key={idx} className="text-xs sm:text-sm text-gray-800">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ul>
      )
    }

    case "quote": {
      return (
        <blockquote
          key={key}
          className="my-1.5 border-l-3 border-blue-500 bg-blue-50/50 rounded-r-md px-3 py-1.5 text-xs sm:text-sm text-gray-700 italic"
        >
          {renderInlineMarkdown(block.text)}
        </blockquote>
      )
    }

    case "hr": {
      return <hr key={key} className="my-2.5 border-gray-200" />
    }

    case "paragraph": {
      return (
        <p key={key} className="text-xs sm:text-sm leading-relaxed text-gray-800 my-1">
          {renderInlineMarkdown(block.text)}
        </p>
      )
    }
  }
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative my-2 rounded-lg border border-gray-200 bg-gray-900 text-gray-100 overflow-hidden shadow-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800/80 border-b border-gray-700 text-[10px] font-mono text-gray-300">
        <span>{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer text-[10px]"
          title="Copy Code"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed text-gray-100">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/**
 * Parses inline markdown: **bold**, *italic*, `code`, [links](url)
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return ""

  // Regular expression to match bold, italic, code, links
  // 1: Bold **...** or __...__
  // 2: Inline code `...`
  // 3: Link [...](...)
  // 4: Italic *...* or _..._
  const parts: React.ReactNode[] = []
  const tokenRegex = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*|_[^_]+_)/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }

    const token = match[0]

    // Bold
    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      const inner = token.slice(2, -2)
      parts.push(
        <strong key={match.index} className="font-semibold text-gray-900">
          {renderInlineMarkdown(inner)}
        </strong>
      )
    }
    // Inline code
    else if (token.startsWith("`") && token.endsWith("`")) {
      const code = token.slice(1, -1)
      parts.push(
        <code
          key={match.index}
          className="px-1.5 py-0.5 rounded bg-gray-200/75 text-blue-700 font-mono text-[11px] font-medium"
        >
          {code}
        </code>
      )
    }
    // Links
    else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        parts.push(
          <a
            key={match.index}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline underline-offset-2 font-medium"
          >
            {linkMatch[1]}
          </a>
        )
      } else {
        parts.push(token)
      }
    }
    // Italic
    else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      const inner = token.slice(1, -1)
      parts.push(
        <em key={match.index} className="italic text-gray-800">
          {renderInlineMarkdown(inner)}
        </em>
      )
    } else {
      parts.push(token)
    }

    lastIndex = tokenRegex.lastIndex
  }

  // Add remaining trailing text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>
}
