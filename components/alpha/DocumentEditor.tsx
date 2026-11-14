"use client"

import { useEffect, useRef, useState } from "react"
import DocumentDescription from "@/components/shapes/DocumentDescription"
import styles from "./whiteboard.module.css"

const ALLOWED = new Set([
  "P", "DIV", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "UL", "OL",
  "LI", "H1", "H2", "H3", "BLOCKQUOTE", "SPAN", "FONT", "A",
])
const DROPPED = ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "MATH"]
const COLOR = /^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i
const LINK = /^(https?:\/\/|mailto:)/i

// Store a deliberately small, inert HTML vocabulary, including pasted content.
function cleanHTML(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html")
  for (const node of Array.from(doc.body.querySelectorAll("*"))) {
    if (DROPPED.includes(node.tagName)) {
      node.remove()
      continue
    }
    if (!ALLOWED.has(node.tagName)) {
      node.replaceWith(...node.childNodes)
      continue
    }
    const element = node as HTMLElement
    const align = element.style.textAlign
    const color = element.style.color
    const href = node.getAttribute("href")
    const fontColor = node.getAttribute("color")
    const size = node.getAttribute("size")
    for (const attribute of Array.from(node.attributes))
      node.removeAttribute(attribute.name)
    if (["left", "center", "right", "justify"].includes(align))
      element.style.textAlign = align
    if (COLOR.test(color)) element.style.color = color
    if (node.tagName === "FONT") {
      if (fontColor && /^(#[\da-f]{3,8}|[a-z]+)$/i.test(fontColor))
        node.setAttribute("color", fontColor)
      if (size && /^[1-7]$/.test(size)) node.setAttribute("size", size)
    }
    if (node.tagName === "A" && href && LINK.test(href)) {
      node.setAttribute("href", href)
      node.setAttribute("rel", "noopener noreferrer")
      node.setAttribute("target", "_blank")
    }
  }
  return doc.body.innerHTML
}

const BLOCKS = [
  ["p", "Normal text"],
  ["h1", "Heading 1"],
  ["h2", "Heading 2"],
  ["h3", "Heading 3"],
  ["blockquote", "Quote"],
] as const
const SIZES = [10, 13, 16, 18, 24, 32, 48]
type Tool = { command: string; symbol: string; label: string; toggles?: boolean }
const GROUPS: Tool[][] = [
  [
    { command: "bold", symbol: "B", label: "Bold (Ctrl+B)", toggles: true },
    { command: "italic", symbol: "I", label: "Italic (Ctrl+I)", toggles: true },
    { command: "underline", symbol: "U", label: "Underline (Ctrl+U)", toggles: true },
    { command: "strikeThrough", symbol: "S", label: "Strikethrough", toggles: true },
  ],
  [
    { command: "insertUnorderedList", symbol: "•", label: "Bulleted list", toggles: true },
    { command: "insertOrderedList", symbol: "1.", label: "Numbered list", toggles: true },
  ],
  [
    { command: "justifyLeft", symbol: "⇤", label: "Align left", toggles: true },
    { command: "justifyCenter", symbol: "↔", label: "Align center", toggles: true },
    { command: "justifyRight", symbol: "⇥", label: "Align right", toggles: true },
  ],
  [
    { command: "undo", symbol: "↶", label: "Undo (Ctrl+Z)" },
    { command: "redo", symbol: "↷", label: "Redo (Ctrl+Shift+Z)" },
    { command: "removeFormat", symbol: "T×", label: "Clear formatting" },
  ],
]
const TOGGLES = GROUPS.flat().filter((t) => t.toggles)
type Formatting = { active: string[]; block: string; size: string; linked: boolean }
const PLAIN: Formatting = { active: [], block: "p", size: "3", linked: false }

export default function DocumentEditor({
  html,
  text,
  onChange,
}: {
  html?: string
  text: string
  onChange: (html: string, text: string) => void
}) {
  const editor = useRef<HTMLDivElement>(null)
  const savedSelection = useRef<Range | null>(null)
  const last = useRef<string | undefined>(undefined)
  const linkField = useRef<HTMLInputElement>(null)
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [formatting, setFormatting] = useState<Formatting>(PLAIN)

  // Only rewrite the page when the stored document changes from outside
  // (restore, sync), never in response to our own typing, so the caret stays put.
  useEffect(() => {
    const el = editor.current
    if (!el) return
    const value = html === undefined ? text : html
    if (last.current === value) return
    if (html === undefined) el.textContent = text
    else el.innerHTML = cleanHTML(html)
    last.current = value
  }, [html, text])

  const linkOpen = link !== null
  useEffect(() => {
    if (linkOpen) linkField.current?.focus()
  }, [linkOpen])

  function anchorAtSelection() {
    const node = window.getSelection()?.anchorNode
    const element = node instanceof Element ? node : node?.parentElement
    const anchor = element?.closest("a")
    return anchor && editor.current?.contains(anchor) ? anchor : null
  }
  function readFormatting() {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !editor.current?.contains(selection.anchorNode))
      return
    savedSelection.current = selection.getRangeAt(0).cloneRange()
    const state = (command: string) => {
      try {
        return document.queryCommandState(command)
      } catch {
        return false
      }
    }
    const value = (command: string) => {
      try {
        return String(document.queryCommandValue(command) ?? "")
      } catch {
        return ""
      }
    }
    const block = value("formatBlock").toLowerCase().replace(/[<>]/g, "")
    const size = value("fontSize")
    const next: Formatting = {
      active: TOGGLES.filter((t) => state(t.command)).map((t) => t.command),
      block: BLOCKS.some(([tag]) => tag === block) ? block : "p",
      size: /^[1-7]$/.test(size) ? size : "3",
      linked: !!anchorAtSelection(),
    }
    setFormatting((prev) =>
      prev.block === next.block &&
      prev.size === next.size &&
      prev.linked === next.linked &&
      prev.active.join() === next.active.join()
        ? prev
        : next
    )
  }
  function save() {
    if (!editor.current) return
    const html = cleanHTML(editor.current.innerHTML)
    last.current = html
    onChange(html, editor.current.innerText)
    readFormatting()
  }
  function restoreSelection() {
    // Read the saved range first: focusing the page moves the caret.
    const range = savedSelection.current
    editor.current?.focus()
    if (range && editor.current?.contains(range.commonAncestorContainer)) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  }
  function format(command: string, value?: string) {
    restoreSelection()
    document.execCommand(command, false, value)
    save()
  }
  function openLink() {
    readFormatting()
    setLink(anchorAtSelection()?.getAttribute("href") ?? "")
    setError("")
  }
  function closeLink() {
    setLink(null)
    setError("")
    restoreSelection()
  }
  function applyLink() {
    const url = (link ?? "").trim()
    if (!LINK.test(url)) {
      setError("Use an https://, http://, or mailto: link.")
      return
    }
    if (savedSelection.current?.collapsed && !anchorAtSelection()) {
      // Nothing selected: insert the address itself as the link text.
      restoreSelection()
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.textContent = url
      document.execCommand("insertHTML", false, cleanHTML(anchor.outerHTML))
      save()
    } else format("createLink", url)
    setLink(null)
  }
  const hold = (e: { preventDefault: () => void }) => e.preventDefault()

  return (
    <div className={styles.documentEditor}>
      <div
        className={styles.formatbar}
        role="toolbar"
        aria-label="Document formatting"
      >
        <select
          aria-label="Paragraph style"
          value={formatting.block}
          onChange={(e) => format("formatBlock", e.target.value)}
        >
          {BLOCKS.map(([tag, label]) => (
            <option key={tag} value={tag}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Text size"
          value={formatting.size}
          onChange={(e) => format("fontSize", e.target.value)}
        >
          {SIZES.map((px, i) => (
            <option key={px} value={i + 1}>
              {px} px
            </option>
          ))}
        </select>
        {GROUPS.map((group, i) => (
          <div className={styles.formatGroup} key={i}>
            {group.map((tool) => (
              <button
                type="button"
                key={tool.command}
                title={tool.label}
                aria-label={tool.label}
                aria-pressed={
                  tool.toggles
                    ? formatting.active.includes(tool.command)
                    : undefined
                }
                data-command={tool.command}
                onMouseDown={hold}
                onClick={() => format(tool.command)}
              >
                {tool.symbol}
              </button>
            ))}
          </div>
        ))}
        <div className={styles.formatGroup}>
          <label className={styles.formatColor} title="Text color">
            <span aria-hidden="true">A</span>
            <input
              type="color"
              aria-label="Text color"
              defaultValue="#e5484d"
              onChange={(e) => format("foreColor", e.target.value)}
            />
          </label>
          <button
            type="button"
            title="Link (Ctrl+K)"
            aria-pressed={formatting.linked}
            aria-expanded={linkOpen}
            onMouseDown={hold}
            onClick={() => (linkOpen ? closeLink() : openLink())}
          >
            Link
          </button>
          {formatting.linked && (
            <button
              type="button"
              title="Remove link"
              onMouseDown={hold}
              onClick={() => format("unlink")}
            >
              Unlink
            </button>
          )}
        </div>
      </div>
      {linkOpen && (
        <form
          className={styles.linkForm}
          onSubmit={(e) => {
            e.preventDefault()
            applyLink()
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              e.stopPropagation()
              closeLink()
            }
          }}
        >
          <input
            ref={linkField}
            aria-label="Link URL"
            aria-invalid={!!error}
            value={link}
            onChange={(e) => {
              setLink(e.target.value)
              setError("")
            }}
            placeholder="https://example.com"
          />
          <button type="submit">Apply</button>
          <button type="button" onClick={closeLink}>
            Cancel
          </button>
          {error && <span role="alert">{error}</span>}
        </form>
      )}
      <div
        ref={editor}
        className={styles.documentPage}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Document text"
        aria-multiline="true"
        data-placeholder="Start writing…"
        data-empty={!text.trim()}
        spellCheck
        onInput={save}
        onMouseUp={readFormatting}
        onKeyUp={readFormatting}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault()
            openLink()
          }
        }}
        onPaste={(e) => {
          e.preventDefault()
          readFormatting()
          const html = e.clipboardData.getData("text/html")
          format(
            html ? "insertHTML" : "insertText",
            html ? cleanHTML(html) : e.clipboardData.getData("text/plain")
          )
        }}
        onDrop={(e) => e.preventDefault()}
      />
      <DocumentDescription text={text} className={styles.wordCount} />
    </div>
  )
}
