"use client"

// The LaTeX source editor: CodeMirror 6 with LaTeX highlighting, completion
// that knows what the cursor is in (a command, an environment name, a
// package, a label, a citation, a file), compiler messages as lint markers,
// and the keys people expect from Overleaf. It is controlled: every edit is
// reported through onChange, and an outside change to `value` is merged in
// as a single undoable edit without moving the cursor. Its own edits coming
// back as `value` are recognised and left alone.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state"
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type Command,
} from "@codemirror/view"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands"
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
  type StringStream,
} from "@codemirror/language"
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionStatus,
  pickedCompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint"
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search"
import { Tag } from "@lezer/highlight"
import styles from "./latex-source.module.css"

export type SourceCompletion = {
  /** "\\section", "itemize", "geometry" */
  label: string
  kind:
    | "command"
    | "environment"
    | "package"
    | "class"
    | "reference"
    | "citation"
    | "file"
  detail?: string
  /** CodeMirror snippet syntax, e.g. "\\frac{${1:num}}{${2:den}}". Missing: insert the label. */
  apply?: string
}
export type SourceDiagnostic = {
  severity: "error" | "warning" | "info"
  message: string
  /** 1-based. Missing: show it on line 1. */
  line?: number
  hint?: string
}
type Props = {
  value: string
  onChange: (value: string) => void
  completions?: SourceCompletion[]
  diagnostics?: SourceDiagnostic[]
  /** Ctrl/Cmd+Enter and Ctrl/Cmd+S. */
  onCompile?: () => void
  /** Scrolls to a line and puts the cursor there; `request` changes each time it is asked for, so the same line can be asked for twice. */
  goto?: { line: number; request: number } | null
  /** Reports the cursor's 1-based line as it moves (for highlighting the current section in an outline). */
  onCursorLine?: (line: number) => void
  readOnly?: boolean
  /** Soft-wrap long lines. Default true. */
  wrap?: boolean
  /** Changes when a different file is shown: resets undo history and scroll. */
  fileKey?: string
  ariaLabel?: string
}

// ---- Highlighting ----

// Our own highlight tags, coloured by CSS variables in latex-source.module.css
// so the editor follows the site theme.
const tag = {
  command: Tag.define(),
  environment: Tag.define(),
  argument: Tag.define(),
  math: Tag.define(),
  mathDelimiter: Tag.define(),
  comment: Tag.define(),
  brace: Tag.define(),
  special: Tag.define(),
}
const highlight = HighlightStyle.define([
  { tag: tag.command, color: "var(--latex-command)" },
  { tag: tag.environment, color: "var(--latex-environment)" },
  { tag: tag.argument, color: "var(--latex-argument)" },
  { tag: tag.math, color: "var(--latex-math)" },
  {
    tag: tag.mathDelimiter,
    color: "var(--latex-math)",
    fontWeight: "bold",
  },
  { tag: tag.comment, color: "var(--latex-comment)", fontStyle: "italic" },
  { tag: tag.brace, color: "var(--latex-brace)" },
  { tag: tag.special, color: "var(--latex-special)" },
])

/** Environments whose body is mathematics. */
const MATH_ENVIRONMENTS = new Set(
  [
    "equation",
    "align",
    "gather",
    "multline",
    "flalign",
    "alignat",
    "eqnarray",
    "displaymath",
    "math",
  ].flatMap((name) => [name, name + "*"])
)
/** Commands whose braced argument is a name, coloured as such. */
const NAME_ARGUMENTS = new Set([
  "usepackage",
  "RequirePackage",
  "documentclass",
  "label",
  "ref",
  "eqref",
  "pageref",
  "autoref",
  "cref",
  "Cref",
  "nameref",
  "cite",
  "citep",
  "citet",
  "parencite",
  "textcite",
  "autocite",
  "footcite",
  "nocite",
  "input",
  "include",
  "includegraphics",
  "bibliography",
  "bibliographystyle",
  "addbibresource",
])

type LatexState = {
  /** Inside mathematics: what closes it ("$", "$$", "\\]", "\\)", or an environment name). */
  math: string | null
  /** A command that takes a highlighted argument was just read. */
  pending: "begin" | "end" | "name" | null
  /** Inside that command's [options]. */
  option: boolean
  /** Inside that command's {argument}. */
  argument: "begin" | "end" | "name" | null
  /** The argument's text so far (the environment name for \begin). */
  text: string
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Reads one token. Returns the name of its tag in `tag`, or null for plain text. */
function token(stream: StringStream, state: LatexState): string | null {
  // The braced argument of \begin, \end, \usepackage, \ref, …
  if (state.argument) {
    if (stream.eat("}")) {
      if (
        state.argument === "begin" &&
        !state.math &&
        MATH_ENVIRONMENTS.has(state.text.trim())
      )
        state.math = "env:" + state.text.trim()
      state.argument = null
      state.text = ""
      return "brace"
    }
    if (stream.eat("%")) {
      stream.skipToEnd()
      return "comment"
    }
    if (stream.match(/^\\[a-zA-Z@]+/)) return "command"
    if (stream.match(/^[^}%\\]+/) || stream.next()) {
      state.text += stream.current()
      return state.argument === "name" ? "argument" : "environment"
    }
  }
  // Between the command and its argument: spaces and [options].
  if (state.pending) {
    if (state.option) {
      if (stream.eat("]")) {
        state.option = false
        return "brace"
      }
    } else {
      if (stream.eatSpace()) return null
      if (stream.eat("[")) {
        state.option = true
        return "brace"
      }
      if (stream.eat("{")) {
        state.argument = state.pending
        state.pending = null
        state.text = ""
        return "brace"
      }
      state.pending = null
    }
  }
  if (stream.eat("%")) {
    stream.skipToEnd()
    return "comment"
  }
  if (state.math) return mathToken(stream, state)

  const verb = stream.match(
    /^\\verb\*?([^a-zA-Z\s*])/
  ) as RegExpMatchArray | null
  if (verb) {
    if (!stream.skipTo(verb[1])) stream.skipToEnd()
    else stream.next()
    return "argument"
  }
  if (stream.match("$$")) {
    state.math = "$$"
    return "mathDelimiter"
  }
  if (stream.eat("$")) {
    state.math = "$"
    return "mathDelimiter"
  }
  if (stream.match("\\[")) {
    state.math = "\\]"
    return "mathDelimiter"
  }
  if (stream.match("\\(")) {
    state.math = "\\)"
    return "mathDelimiter"
  }
  const command = stream.match(/^\\([a-zA-Z@]+)\*?/) as RegExpMatchArray | null
  if (command) {
    const name = command[1]
    if (name === "begin" || name === "end") state.pending = name
    else if (NAME_ARGUMENTS.has(name)) state.pending = "name"
    return "command"
  }
  if (stream.eat("\\")) {
    stream.next()
    return "special"
  }
  if (stream.match(/^[{}[\]()]/)) return "brace"
  if (stream.match(/^[&~]/)) return "special"
  if (stream.match(/^[^\\$%{}[\]()&~]+/)) return null
  stream.next()
  return null
}

function mathToken(stream: StringStream, state: LatexState): string | null {
  const close = state.math!
  if (close.startsWith("env:")) {
    // Only the \end of the same environment closes it.
    const ending = new RegExp(
      "^\\\\end\\s*\\{" + escapeRegExp(close.slice(4)) + "\\}"
    )
    if (stream.match(ending, false)) {
      stream.match("\\end")
      state.math = null
      state.pending = "end"
      return "command"
    }
  } else if (stream.match(close)) {
    state.math = null
    return "mathDelimiter"
  }
  const command = stream.match(/^\\([a-zA-Z@]+)\*?/) as RegExpMatchArray | null
  if (command) {
    if (command[1] === "begin" || command[1] === "end")
      state.pending = command[1]
    return "command"
  }
  if (stream.eat("\\")) {
    stream.next()
    return "command"
  }
  if (stream.match(/^[{}[\]()]/)) return "brace"
  if (stream.match(/^[^\\$%{}[\]()]+/)) return "math"
  stream.next()
  return "math"
}

const latex = StreamLanguage.define<LatexState>({
  name: "latex",
  startState: () => ({
    math: null,
    pending: null,
    option: false,
    argument: null,
    text: "",
  }),
  copyState: (state) => ({ ...state }),
  token,
  blankLine(state) {
    // A paragraph break ends inline maths and half-typed commands, so one
    // stray $ does not colour the rest of the document.
    if (state.math === "$" || state.math === "\\)") state.math = null
    state.pending = null
    state.option = false
    state.argument = null
  },
  tokenTable: tag,
  languageData: {
    commentTokens: { line: "%" },
    // Pairs also close in front of a $, so {$[( inside maths all pair up.
    closeBrackets: { brackets: ["(", "[", "{", "$"], before: ")]}:;>$" },
  },
})

// ---- Completion ----

type Kind = SourceCompletion["kind"]
type Index = Record<Kind, Completion[]> & {
  /** Environments that, accepted after \begin{, also write the \end{}. */
  begin: Completion[]
}
const ICONS: Record<Kind, string> = {
  command: "function",
  environment: "type",
  package: "namespace",
  class: "class",
  reference: "constant",
  citation: "text",
  file: "variable",
}
const EMPTY_INDEX: Index = {
  command: [],
  environment: [],
  package: [],
  class: [],
  reference: [],
  citation: [],
  file: [],
  begin: [],
}

/** Applies a snippet; snippets are parsed the first time they are used. */
const snippets = new Map<string, ReturnType<typeof snippet>>()
function applySnippet(template: string) {
  return (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number
  ) => {
    let apply = snippets.get(template)
    if (!apply) {
      apply = snippet(template)
      snippets.set(template, apply)
    }
    apply(view, completion, from, to)
  }
}

/** Whether a \begin{name} written just before `after` already has its \end. */
function closedLater(after: string, name: string) {
  let depth = 0
  for (const match of after.matchAll(/\\(begin|end)\s*\{([^{}]*)\}/g)) {
    if (match[2] !== name) continue
    if (match[1] === "begin") depth++
    else if (depth === 0) return true
    else depth--
  }
  return false
}

/** Accepting an environment after \begin{ also writes its \end{} with the cursor between. */
function beginEnvironment(name: string) {
  return (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number
  ) => {
    const { state } = view
    const line = state.doc.lineAt(to)
    // Swallow the rest of the name being replaced and the closing brace.
    const tail = /^[^{}\s,]*\}?/.exec(line.text.slice(to - line.from))![0]
    const end = to + tail.length
    const restOfLine = state.sliceDoc(end, line.to)
    if (restOfLine.trim() || closedLater(state.sliceDoc(end), name)) {
      view.dispatch({
        changes: { from, to: end, insert: name + "}" },
        selection: { anchor: from + name.length + 1 },
        annotations: pickedCompletion.of(completion),
        userEvent: "input.complete",
        scrollIntoView: true,
      })
      return
    }
    applySnippet(`${name}}\n\t\${0}\n\\end{${name}}`)(
      view,
      completion,
      from,
      end
    )
  }
}

function buildIndex(completions: SourceCompletion[]): Index {
  const index: Index = {
    command: [],
    environment: [],
    package: [],
    class: [],
    reference: [],
    citation: [],
    file: [],
    begin: [],
  }
  for (const entry of completions) {
    const option: Completion = {
      label: entry.label,
      type: ICONS[entry.kind],
      detail: entry.detail,
      apply: entry.apply ? applySnippet(entry.apply) : undefined,
    }
    index[entry.kind].push(option)
    if (entry.kind === "environment")
      index.begin.push({
        ...option,
        apply: entry.apply
          ? applySnippet(entry.apply)
          : beginEnvironment(entry.label),
      })
  }
  return index
}

const setIndex = StateEffect.define<Index>()
const indexField = StateField.define<Index>({
  create: () => EMPTY_INDEX,
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setIndex)) value = effect.value
    return value
  },
})

const ARGUMENT_KINDS: Record<string, Kind> = {
  begin: "environment",
  end: "environment",
  usepackage: "package",
  RequirePackage: "package",
  documentclass: "class",
  ref: "reference",
  eqref: "reference",
  pageref: "reference",
  autoref: "reference",
  cref: "reference",
  Cref: "reference",
  cite: "citation",
  citep: "citation",
  citet: "citation",
  parencite: "citation",
  textcite: "citation",
  input: "file",
  include: "file",
  includegraphics: "file",
}

/** The innermost environment opened before `pos` and not yet closed. */
function openEnvironment(text: string) {
  const stack: string[] = []
  for (const match of text.matchAll(/\\(begin|end)\s*\{([^{}]*)\}/g)) {
    if (match[1] === "begin") stack.push(match[2])
    else {
      const at = stack.lastIndexOf(match[2])
      if (at >= 0) stack.length = at
    }
  }
  return stack.at(-1)
}

function latexCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  // Nothing inside a comment.
  if (/(^|[^\\])(\\\\)*%/.test(before)) return null
  const index = state.field(indexField)

  // A command: an odd run of backslashes (\\ is a line break) then letters.
  const command = /(\\+)([a-zA-Z@]*)$/.exec(before)
  if (command && command[1].length % 2 === 1) {
    if (!index.command.length) return null
    return {
      from: pos - command[2].length - 1,
      options: index.command,
      validFor: /^\\[a-zA-Z@]*$/,
    }
  }

  // An argument: \name[options]{text so far
  const argument = /\\([a-zA-Z]+)\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)$/.exec(
    before
  )
  if (!argument) return null
  const name = argument[1]
  const kind = ARGUMENT_KINDS[name]
  if (!kind) return null
  const file = kind === "file"
  const word = (file ? /[^{}]*$/ : /[^,{}\s]*$/).exec(argument[2])![0]
  let options = name === "begin" ? index.begin : index[kind]
  if (name === "end") {
    // The environment waiting to be closed comes first.
    const open = openEnvironment(state.sliceDoc(0, pos - argument[0].length))
    if (open)
      options = [
        { label: open, type: ICONS.environment, detail: "open", boost: 99 },
        ...options.filter((option) => option.label !== open),
      ]
  }
  if (!options.length) return null
  return {
    from: pos - word.length,
    options,
    validFor: file ? /^[^{}]*$/ : /^[^,{}\s]*$/,
  }
}

// ---- Keys ----

/** Wraps each selection in \command{…}, or unwraps it if it already is. */
function wrapWith(command: string): Command {
  return (view) => {
    if (view.state.readOnly) return true
    const open = `\\${command}{`
    const { state } = view
    view.dispatch(
      state.changeByRange((range) => {
        const wrapped =
          state.sliceDoc(range.from - open.length, range.from) === open &&
          state.sliceDoc(range.to, range.to + 1) === "}"
        if (wrapped)
          return {
            changes: [
              { from: range.from - open.length, to: range.from },
              { from: range.to, to: range.to + 1 },
            ],
            range: EditorSelection.range(
              range.from - open.length,
              range.to - open.length
            ),
          }
        return {
          changes: [
            { from: range.from, insert: open },
            { from: range.to, insert: "}" },
          ],
          range: EditorSelection.range(
            range.from + open.length,
            range.to + open.length
          ),
        }
      }),
      { scrollIntoView: true, userEvent: "input" }
    )
    return true
  }
}

/** Tab accepts an open completion, indents a selection, or inserts spaces. */
const tab: Command = (view) => {
  const { state } = view
  if (state.readOnly) return false
  if (completionStatus(state) === "active" && state.selection.main.empty)
    return acceptCompletion(view)
  if (state.selection.ranges.some((range) => !range.empty))
    return indentMore(view)
  view.dispatch(state.replaceSelection(state.facet(indentUnit)), {
    scrollIntoView: true,
    userEvent: "input",
  })
  return true
}

// ---- Look ----

const look = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    color: "var(--foreground)",
    backgroundColor: "var(--background)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono), monospace",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--foreground)", padding: "6px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor:
        "var(--scheme-select, color-mix(in srgb, var(--alpha-accent, var(--ring)) 28%, transparent))",
    },
  ".cm-gutters": {
    backgroundColor: "var(--surface, var(--background))",
    color: "var(--dim, var(--muted-foreground))",
    borderRight: "1px solid var(--line, var(--border))",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 10px" },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--hover)",
    color: "var(--foreground)",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor:
      "color-mix(in srgb, var(--alpha-accent, var(--ring)) 30%, transparent)",
    outline:
      "1px solid color-mix(in srgb, var(--alpha-accent, var(--ring)) 60%, transparent)",
  },
  "&.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--destructive) 30%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--foreground) 12%, transparent)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, #f59e0b 35%, transparent)",
    outline: "1px solid color-mix(in srgb, #f59e0b 70%, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, #f59e0b 65%, transparent)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
    border: "1px solid var(--line, var(--border))",
    borderRadius: "var(--radius)",
    boxShadow: "0 6px 24px #00000040",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono), monospace",
    maxHeight: "16em",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "1px 8px" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--alpha-accent, var(--ring))",
    color: "var(--background)",
  },
  ".cm-completionDetail": { opacity: 0.7, marginLeft: "1em" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "bold" },
  ".cm-completionIcon": { opacity: 0.7 },
  ".cm-panels": {
    backgroundColor: "var(--surface, var(--background))",
    color: "var(--foreground)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--line, var(--border))",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--line, var(--border))",
  },
  ".cm-diagnostic": { padding: "4px 8px", maxWidth: "60ch" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--latex-error)" },
  ".cm-diagnostic-warning": { borderLeftColor: "#f59e0b" },
  ".cm-diagnostic-info": { borderLeftColor: "var(--latex-environment)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--hover)",
    border: "1px solid var(--line)",
    color: "var(--dim)",
  },
})

/** Marks external changes to the document, so they are not reported back. */
const external = Annotation.define<boolean>()

type Handlers = {
  onChange: (value: string) => void
  onCompile?: () => void
  onCursorLine?: (line: number) => void
}

function toDiagnostics(
  state: EditorState,
  list: SourceDiagnostic[]
): Diagnostic[] {
  return list.map((item) => {
    const number = Math.min(
      Math.max(1, Math.floor(item.line ?? 1)),
      state.doc.lines
    )
    const line = state.doc.line(number)
    const indent = /^\s*/.exec(line.text)![0].length
    return {
      from: line.from + (indent < line.length ? indent : 0),
      to: line.to,
      severity: item.severity,
      message: item.message,
      renderMessage: () => {
        const box = document.createElement("div")
        box.textContent = item.message
        if (item.hint) {
          const hint = document.createElement("div")
          hint.className = styles.hint
          hint.textContent = item.hint
          box.append(hint)
        }
        return box
      },
    }
  })
}

export default function LatexSource({
  value,
  onChange,
  completions,
  diagnostics,
  onCompile,
  goto,
  onCursorLine,
  readOnly = false,
  wrap = true,
  fileKey,
  ariaLabel = "LaTeX source",
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [compartments] = useState(() => ({
    readOnly: new Compartment(),
    wrap: new Compartment(),
    label: new Compartment(),
  }))
  const index = useMemo(() => buildIndex(completions ?? []), [completions])
  // The latest props, for the editor's callbacks and for building a fresh
  // editor state. Written after each render, read only from effects and
  // editor callbacks.
  const latest = useRef({
    value,
    fileKey,
    index,
    diagnostics,
    readOnly,
    wrap,
    ariaLabel,
    handlers: { onChange, onCompile, onCursorLine } as Handlers,
  })
  // Values this editor has reported that may still come back as `value`,
  // oldest first, and the file the editor is showing.
  const sync = useRef({ fileKey, sent: [] as string[], line: 0 })
  /** Starts a fresh editor state for a different file (set once the editor exists). */
  const restart = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    latest.current = {
      value,
      fileKey,
      index,
      diagnostics,
      readOnly,
      wrap,
      ariaLabel,
      handlers: { onChange, onCompile, onCursorLine },
    }
  })

  // Create the editor once; props reach it through effects below.
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const settings = () => latest.current
    const handlers = () => latest.current.handlers

    const keys = keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          handlers().onCompile?.()
          return true
        },
      },
      {
        key: "Mod-s",
        run: () => {
          handlers().onCompile?.()
          return true
        },
      },
      { key: "Mod-b", run: wrapWith("textbf") },
      { key: "Mod-i", run: wrapWith("textit") },
      { key: "Tab", run: tab, shift: indentLess },
    ])
    const report = EditorView.updateListener.of((update) => {
      if (
        update.docChanged &&
        !update.transactions.some((tr) => tr.annotation(external))
      ) {
        const text = update.state.doc.toString()
        const { sent } = sync.current
        sent.push(text)
        if (sent.length > 64) sent.splice(0, sent.length - 64)
        handlers().onChange(text)
      }
      if (update.docChanged || update.selectionSet) {
        const line = update.state.doc.lineAt(
          update.state.selection.main.head
        ).number
        if (line !== sync.current.line) {
          sync.current.line = line
          handlers().onCursorLine?.(line)
        }
      }
    })
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      lintGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      indentUnit.of("  "),
      latex,
      syntaxHighlighting(highlight),
      bracketMatching(),
      closeBrackets(),
      autocompletion({
        override: [latexCompletions],
        icons: true,
        maxRenderedOptions: 80,
      }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      indexField,
      keys,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
      ]),
      look,
      report,
    ]

    const fresh = () => {
      const now = settings()
      return EditorState.create({
        doc: now.value,
        extensions: [
          extensions,
          compartments.readOnly.of([
            EditorState.readOnly.of(now.readOnly),
            EditorView.editable.of(!now.readOnly),
          ]),
          compartments.wrap.of(now.wrap ? EditorView.lineWrapping : []),
          compartments.label.of(
            EditorView.contentAttributes.of({ "aria-label": now.ariaLabel })
          ),
        ],
      })
    }
    const editor = new EditorView({ state: fresh(), parent })
    view.current = editor
    const now = settings()
    editor.dispatch(
      { effects: setIndex.of(now.index) },
      setDiagnostics(
        editor.state,
        toDiagnostics(editor.state, now.diagnostics ?? [])
      )
    )
    sync.current = { fileKey: now.fileKey, sent: [], line: 1 }
    handlers().onCursorLine?.(1)
    // A different file: a fresh state (no undo history), scrolled to the top.
    restart.current = () => {
      editor.setState(fresh())
      const again = settings()
      editor.dispatch(
        { effects: setIndex.of(again.index) },
        setDiagnostics(
          editor.state,
          toDiagnostics(editor.state, again.diagnostics ?? [])
        )
      )
      editor.scrollDOM.scrollTop = 0
      editor.scrollDOM.scrollLeft = 0
      sync.current = { fileKey: again.fileKey, sent: [], line: 1 }
      handlers().onCursorLine?.(1)
    }
    return () => {
      editor.destroy()
      view.current = null
      restart.current = null
    }
  }, [compartments])

  // Outside changes to the text, and switching files.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    if (fileKey !== sync.current.fileKey) {
      restart.current?.()
      return
    }
    // Our own edit coming back: forget it and everything sent before it.
    const { sent } = sync.current
    const echo = sent.indexOf(value)
    if (echo >= 0) {
      sent.splice(0, echo + 1)
      return
    }
    sent.length = 0
    const current = editor.state.doc.toString()
    if (current === value) return
    // Replace only the part that differs, so the cursor and the rest of the
    // document stay put, and the change is one step in the undo history.
    let start = 0
    const shortest = Math.min(current.length, value.length)
    while (
      start < shortest &&
      current.charCodeAt(start) === value.charCodeAt(start)
    )
      start++
    let endOld = current.length
    let endNew = value.length
    while (
      endOld > start &&
      endNew > start &&
      current.charCodeAt(endOld - 1) === value.charCodeAt(endNew - 1)
    ) {
      endOld--
      endNew--
    }
    editor.dispatch({
      changes: { from: start, to: endOld, insert: value.slice(start, endNew) },
      annotations: external.of(true),
    })
  }, [value, fileKey])

  useEffect(() => {
    view.current?.dispatch({ effects: setIndex.of(index) })
  }, [index])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    editor.dispatch(
      setDiagnostics(
        editor.state,
        toDiagnostics(editor.state, diagnostics ?? [])
      )
    )
  }, [diagnostics])

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.readOnly.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    })
  }, [readOnly, compartments])

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.wrap.reconfigure(
        wrap ? EditorView.lineWrapping : []
      ),
    })
  }, [wrap, compartments])

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.label.reconfigure(
        EditorView.contentAttributes.of({ "aria-label": ariaLabel })
      ),
    })
  }, [ariaLabel, compartments])

  const gotoLine = goto?.line
  const gotoRequest = goto?.request
  useEffect(() => {
    const editor = view.current
    if (!editor || gotoLine === undefined) return
    const { doc } = editor.state
    const line = doc.line(
      Math.min(Math.max(1, Math.floor(gotoLine)), doc.lines)
    )
    editor.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, {
        y: "start",
        yMargin: 48,
      }),
    })
    editor.focus()
  }, [gotoLine, gotoRequest])

  return <div ref={host} className={styles.editor} />
}
