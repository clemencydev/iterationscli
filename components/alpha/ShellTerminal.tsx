"use client"

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react"
import type { useCompletion } from "@/hooks/use-completion"
import type { CompletionCommand } from "@/lib/completion"
import {
  confirmPrompt,
  editLine,
  highlight,
  searchHistory,
  searchPrompt,
  SHELL_TITLES,
  type Edit,
  type Segment,
  type ShellFlavor,
} from "@/lib/shell"
import styles from "./shell-terminal.module.css"

export type LogEntry =
  | {
      kind: "command"
      prompt: Segment[]
      text: string
      /** An answer to a question, not a command: leave it uncoloured. */
      plain?: boolean
    }
  | { kind: "output" | "error" | "banner"; text: string }

type Search = { query: string; index: number; draft: string }

/**
 * The workspace terminal: a scrollback with the prompt at the end of it, in
 * the dress of the visitor's own shell. It owns the keyboard (history, search,
 * line editing, completion); what a command does is decided by its parent.
 */
export default function ShellTerminal({
  flavor,
  title,
  status,
  prompt,
  entries,
  value,
  onChange,
  onSubmit,
  completion,
  registry,
  history,
  confirming,
  onClear,
  onCancel,
  onExit,
  inputRef,
  inputId,
  chrome = true,
  autoFocus = false,
}: {
  flavor: ShellFlavor
  /** Shown in the window's title bar. */
  title: string
  /** Short state shown at the edge of the title bar, e.g. LOCAL. */
  status: string
  prompt: Segment[]
  entries: LogEntry[]
  value: string
  onChange: (value: string) => void
  /** Runs `line`, or the current input when it is omitted. */
  onSubmit: (line?: string) => void
  completion: ReturnType<typeof useCompletion>
  /** Commands, for colouring what is typed. */
  registry: Record<string, CompletionCommand>
  history: string[]
  /** A yes/no question is waiting for an answer. */
  confirming: boolean
  onClear: () => void
  onCancel: () => void
  onExit: () => void
  inputRef: RefObject<HTMLInputElement | null>
  inputId: string
  /** Draw the shell's own title bar. Off when a window already frames it. */
  chrome?: boolean
  autoFocus?: boolean
}) {
  const screen = useRef<HTMLDivElement>(null)
  const paint = useRef<HTMLDivElement>(null)
  // Where ↑/↓ are in the history; history.length means "the line being typed".
  const cursor = useRef(history.length)
  const draft = useRef("")
  const caret = useRef<number | null>(null)
  const [search, setSearch] = useState<Search | null>(null)

  const found = search !== null && search.index >= 0
  const shown = search ? (found ? history[search.index] : search.draft) : value
  const tokens = useMemo(
    () =>
      confirming || search
        ? [{ text: shown, kind: "argument" as const }]
        : highlight(shown, registry),
    [confirming, search, shown, registry]
  )

  useEffect(() => {
    cursor.current = history.length
  }, [history])
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true })
  }, [autoFocus, inputRef])
  // Keep the newest line in view, like a terminal does.
  useLayoutEffect(() => {
    const node = screen.current
    if (node) node.scrollTop = node.scrollHeight
  }, [entries, shown, completion.candidates.length, confirming])
  // Put the caret where a line edit left it, and keep the coloured copy of
  // the line scrolled with the real input.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    if (caret.current !== null) {
      input.setSelectionRange(caret.current, caret.current)
      caret.current = null
    }
    if (paint.current) paint.current.scrollLeft = input.scrollLeft
  })

  const set = (next: string, at = next.length) => {
    caret.current = at
    onChange(next)
  }
  const edit = (input: HTMLInputElement, action: Edit) => {
    const next = editLine(
      { value, caret: input.selectionStart ?? value.length },
      action
    )
    set(next.value, next.caret)
  }
  const recall = (delta: number) => {
    if (cursor.current === history.length) draft.current = value
    cursor.current = Math.max(
      0,
      Math.min(history.length, cursor.current + delta)
    )
    set(
      cursor.current === history.length
        ? draft.current
        : history[cursor.current]
    )
  }

  /** Keys while Ctrl+R history search is open. Returns true when handled. */
  function searchKeys(e: KeyboardEvent<HTMLInputElement>, current: Search) {
    const key = e.key.toLowerCase()
    const leave = (line: string) => {
      setSearch(null)
      set(line)
    }
    if (e.ctrlKey && key === "r") {
      const older = searchHistory(history, current.query, current.index)
      if (older >= 0) setSearch({ ...current, index: older })
    } else if (e.key === "Enter") {
      setSearch(null)
      onSubmit(found ? history[current.index] : current.draft)
    } else if (e.key === "Escape" || (e.ctrlKey && (key === "g" || key === "c"))) {
      leave(current.draft)
    } else if (e.key === "Backspace") {
      const query = current.query.slice(0, -1)
      setSearch({ ...current, query, index: searchHistory(history, query) })
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const query = current.query + e.key
      setSearch({ ...current, query, index: searchHistory(history, query) })
    } else if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
      return true
    } else {
      // Any other key (arrows, Tab, End…) keeps the match as the line to edit.
      leave(found ? history[current.index] : current.draft)
    }
    e.preventDefault()
    return true
  }

  function keys(e: KeyboardEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const key = e.key.toLowerCase()
    if (search) return void searchKeys(e, search)
    if (!confirming && completion.onKeyDown(e)) return
    // While a line is being typed Tab belongs to completion, even when there
    // is nothing to complete. On an empty line it moves focus as usual, so
    // the keyboard can always leave the terminal.
    if (e.key === "Tab" && value && !e.ctrlKey && !e.altKey && !e.metaKey)
      return e.preventDefault()
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      if (key === "r" && !confirming) {
        handled()
        setSearch({ query: "", index: -1, draft: value })
      } else if (key === "l") {
        handled()
        onClear()
      } else if (key === "c" && input.selectionStart === input.selectionEnd) {
        handled()
        onCancel()
      } else if (key === "d" && !value) {
        handled()
        onExit()
      } else if (key === "u") {
        handled()
        edit(input, "kill-to-start")
      } else if (key === "k") {
        handled()
        edit(input, "kill-to-end")
      } else if (key === "backspace") {
        handled()
        edit(input, "delete-word-back")
      } else if (key === "delete") {
        handled()
        edit(input, "delete-word-forward")
      } else if (flavor !== "powershell" && (key === "a" || key === "e")) {
        // PowerShell keeps Ctrl+A for "select all", as on Windows.
        handled()
        edit(input, key === "a" ? "start" : "end")
      }
      return
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const action: Edit | null =
        key === "arrowleft" || key === "b"
          ? "word-back"
          : key === "arrowright" || key === "f"
            ? "word-forward"
            : key === "backspace"
              ? "delete-word-back"
              : key === "d"
                ? "delete-word-forward"
                : null
      if (action) {
        handled()
        edit(input, action)
      }
      return
    }
    if (e.key === "Escape" && value) {
      // First Esc empties the line; with an empty line it is left to the
      // window, which closes on it.
      handled()
      set("")
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      handled()
      if (!confirming) recall(e.key === "ArrowUp" ? -1 : 1)
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      handled()
      const node = screen.current
      if (node)
        node.scrollTop +=
          node.clientHeight * 0.8 * (e.key === "PageUp" ? -1 : 1)
    }
  }

  const label = search
    ? [{ text: searchPrompt(flavor, search.query, found || !search.query) }]
    : confirming
      ? [{ text: confirmPrompt(flavor) }]
      : prompt
  const menu = !search && !confirming ? completion.candidates : []

  return (
    <section
      className={styles.terminal}
      data-shell={flavor}
      aria-label={`Terminal (${SHELL_TITLES[flavor]})`}
      onMouseUp={() => {
        // A click lands in the prompt, unless it was a drag to select text.
        if (!window.getSelection()?.toString())
          inputRef.current?.focus({ preventScroll: true })
      }}
    >
      {chrome && (
        <header className={styles.titlebar}>
          <span className={styles.lights} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className={styles.title}>
            <b aria-hidden="true">{flavor === "powershell" ? "PS" : ">_"}</b>
            {title}
          </span>
          <span className={styles.status}>{status}</span>
        </header>
      )}
      <div className={styles.screen} ref={screen}>
        <div role="log" aria-label="Command output">
          {entries.map((entry, i) =>
            entry.kind === "command" ? (
              <pre key={i} className={styles.echo}>
                <Prompt segments={entry.prompt} />
                {entry.plain ? (
                  entry.text
                ) : (
                  <Tokens tokens={highlight(entry.text, registry)} />
                )}
              </pre>
            ) : (
              <pre key={i} className={styles[entry.kind]}>
                {entry.text}
              </pre>
            )
          )}
        </div>
        <form
          className={styles.line}
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <label htmlFor={inputId}>
            <Prompt segments={label} />
          </label>
          <div className={styles.field}>
            <div className={styles.paint} ref={paint} aria-hidden="true">
              <Tokens tokens={tokens} />
              {!search && !confirming && (
                <span className={styles.ghost}>{completion.suggestion}</span>
              )}
            </div>
            <input
              id={inputId}
              ref={inputRef}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              role="combobox"
              aria-label="Command line"
              aria-expanded={menu.length > 0}
              aria-controls={`${inputId}-completions`}
              aria-autocomplete="both"
              value={shown}
              onChange={(e) => {
                // Text that arrives without key presses during a search (a
                // paste, an input method) becomes the line itself.
                if (search) setSearch(null)
                onChange(e.target.value)
              }}
              onKeyDown={keys}
              onScroll={(e) => {
                if (paint.current)
                  paint.current.scrollLeft = e.currentTarget.scrollLeft
              }}
            />
          </div>
        </form>
        {menu.length > 0 && (
          <div
            className={styles.menu}
            role="listbox"
            aria-label="Completions"
            id={`${inputId}-completions`}
          >
            {menu.slice(0, 8).map((candidate, i) => (
              <button
                type="button"
                role="option"
                key={candidate.value}
                aria-selected={i === completion.active}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  completion.accept(candidate.value)
                  inputRef.current?.focus()
                }}
              >
                <b>{candidate.value}</b>
                <span>{candidate.description}</span>
              </button>
            ))}
            {menu.length > 8 && (
              <p>
                … {menu.length - 8} more, keep typing to narrow
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function Prompt({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, i) => (
        <span key={i} className={segment.tone ? styles[segment.tone] : ""}>
          {segment.text}
        </span>
      ))}
    </>
  )
}

function Tokens({ tokens }: { tokens: ReturnType<typeof highlight> }) {
  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} className={styles[token.kind]}>
          {token.text}
        </span>
      ))}
    </>
  )
}
