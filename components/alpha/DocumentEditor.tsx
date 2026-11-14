"use client"

import { useEffect, useRef, useState } from "react"
import styles from "./whiteboard.module.css"

// Store a deliberately small, inert HTML vocabulary, including pasted content.
function cleanHTML(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html")
  const allowed = new Set(["P", "DIV", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "UL", "OL", "LI", "H1", "H2", "H3", "BLOCKQUOTE", "SPAN", "FONT", "A"])
  for (const node of Array.from(doc.body.querySelectorAll("*"))) {
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "MATH"].includes(node.tagName)) { node.remove(); continue }
    if (!allowed.has(node.tagName)) { node.replaceWith(...node.childNodes); continue }
    const align = (node as HTMLElement).style.textAlign
    const color = (node as HTMLElement).style.color
    const href = node.getAttribute("href")
    const fontColor = node.getAttribute("color")
    const size = node.getAttribute("size")
    for (const attribute of Array.from(node.attributes)) node.removeAttribute(attribute.name)
    if (["left", "center", "right", "justify"].includes(align)) (node as HTMLElement).style.textAlign = align
    if (/^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i.test(color)) (node as HTMLElement).style.color = color
    if (node.tagName === "FONT") {
      if (fontColor && /^(#[\da-f]{3,8}|[a-z]+)$/i.test(fontColor)) node.setAttribute("color", fontColor)
      if (size && /^[1-7]$/.test(size)) node.setAttribute("size", size)
    }
    if (node.tagName === "A" && href && /^(https?:\/\/|mailto:)/i.test(href)) { node.setAttribute("href", href); node.setAttribute("rel", "noopener noreferrer"); node.setAttribute("target", "_blank") }
  }
  return doc.body.innerHTML
}

export default function DocumentEditor({ html, text, onChange }: { html?: string; text: string; onChange: (html: string, text: string) => void }) {
  const editor = useRef<HTMLDivElement>(null)
  const savedSelection = useRef<Range | null>(null)
  const last = useRef<string | undefined>(undefined)
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    const el = editor.current
    if (!el) return
    const value = html === undefined ? text : html
    if (last.current === value) return
    if (html === undefined) el.textContent = text
    else el.innerHTML = cleanHTML(html)
    last.current = value
  }, [html, text])
  function rememberSelection() {
    const selection = window.getSelection()
    if (selection?.rangeCount && editor.current?.contains(selection.anchorNode)) savedSelection.current = selection.getRangeAt(0).cloneRange()
  }
  function save() {
    if (!editor.current) return
    const html = cleanHTML(editor.current.innerHTML)
    last.current = html
    onChange(html, editor.current.innerText)
    rememberSelection()
  }
  function format(command: string, value?: string) {
    editor.current?.focus()
    const range = savedSelection.current
    if (range && editor.current?.contains(range.commonAncestorContainer)) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range) }
    document.execCommand(command, false, value)
    save()
  }
  const tools = [["bold", "B", "Bold"], ["italic", "I", "Italic"], ["underline", "U", "Underline"], ["strikeThrough", "S̶", "Strikethrough"], ["insertUnorderedList", "• List", "Bulleted list"], ["insertOrderedList", "1. List", "Numbered list"], ["justifyLeft", "⇤", "Align left"], ["justifyCenter", "↔", "Align center"], ["justifyRight", "⇥", "Align right"], ["undo", "↶", "Undo text edit"], ["redo", "↷", "Redo text edit"], ["removeFormat", "Tx", "Clear formatting"]]
  return <div className={styles.documentEditor}>
    <div className={styles.formatbar} role="toolbar" aria-label="Document formatting">
      <select aria-label="Paragraph style" defaultValue="p" onChange={e => format("formatBlock", e.target.value)}><option value="p">Normal text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="blockquote">Quote</option></select>
      <select aria-label="Text size" defaultValue="3" onChange={e => format("fontSize", e.target.value)}>{[1, 2, 3, 4, 5, 6, 7].map((n, i) => <option key={n} value={n}>{[10, 13, 16, 18, 24, 32, 48][i]} px</option>)}</select>
      {tools.map(([command, symbol, label]) => <button type="button" key={command} title={label} aria-label={label} onMouseDown={e => e.preventDefault()} onClick={() => format(command)}>{symbol}</button>)}
      <input type="color" aria-label="Text color" defaultValue="#777777" onChange={e => format("foreColor", e.target.value)} />
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { rememberSelection(); setLink(""); setError("") }}>Link</button>
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => format("unlink")}>Unlink</button>
    </div>
    {link !== null && <form className={styles.linkForm} onSubmit={e => { e.preventDefault(); if (!/^(https?:\/\/|mailto:)/i.test(link.trim())) { setError("Use an https://, http://, or mailto: link."); return } format("createLink", link.trim()); setLink(null) }}><input aria-label="Link URL" value={link} onChange={e => setLink(e.target.value)} placeholder="https://example.com" /><button>Apply</button><button type="button" onClick={() => setLink(null)}>Cancel</button>{error && <span role="alert">{error}</span>}</form>}
    <div ref={editor} className={styles.documentPage} contentEditable suppressContentEditableWarning role="textbox" aria-label="Document text" aria-multiline="true" spellCheck onInput={save} onMouseUp={rememberSelection} onKeyUp={rememberSelection} onBlur={rememberSelection} onPaste={e => { e.preventDefault(); rememberSelection(); const html = e.clipboardData.getData("text/html"); format(html ? "insertHTML" : "insertText", html ? cleanHTML(html) : e.clipboardData.getData("text/plain")) }} onDrop={e => e.preventDefault()} />
    <div className={styles.wordCount}>{text.trim() ? text.trim().split(/\s+/).length : 0} words · {text.length} characters</div>
  </div>
}
