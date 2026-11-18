// What makes the workspace terminal behave like a shell: which shell it
// imitates, its prompt and startup text, line editing, history search and
// syntax colouring. Pure, so it runs under `node --test`.
import type { CompletionCommand } from "./completion.ts"

export type ShellFlavor = "powershell" | "bash" | "zsh"
export const SHELLS: ShellFlavor[] = ["powershell", "bash", "zsh"]
export const SHELL_TITLES: Record<ShellFlavor, string> = {
  powershell: "PowerShell",
  bash: "bash",
  zsh: "zsh",
}

/** The shell someone on this operating system is used to. */
export function detectShell(platform: string): ShellFlavor {
  if (/win/i.test(platform)) return "powershell"
  if (/mac|iphone|ipad|ios/i.test(platform)) return "zsh"
  return "bash"
}

export const isShell = (value: unknown): value is ShellFlavor =>
  SHELLS.includes(value as ShellFlavor)

export type PromptContext = {
  user: string
  /** Folder-style name of the workspace, e.g. "personal". */
  workspace: string
  /** The open view; "terminal" is the workspace's home. */
  view: string
}
export type Segment = {
  text: string
  tone?: "user" | "path" | "symbol"
}

/** The prompt, in pieces so each shell can colour it its own way. */
export function promptSegments(
  flavor: ShellFlavor,
  { user, workspace, view }: PromptContext
): Segment[] {
  const home = view === "terminal"
  if (flavor === "powershell")
    return [
      { text: "PS ", tone: "symbol" },
      {
        text: `iterations:\\${workspace}${home ? "" : `\\${view}`}`,
        tone: "path",
      },
      { text: "> ", tone: "symbol" },
    ]
  if (flavor === "zsh")
    return [
      { text: `${user}@iterations`, tone: "user" },
      { text: ` ${home ? "~" : view}`, tone: "path" },
      { text: " % ", tone: "symbol" },
    ]
  return [
    { text: `${user}@iterations`, tone: "user" },
    { text: ":", tone: "symbol" },
    { text: home ? `~/${workspace}` : `~/${workspace}/${view}`, tone: "path" },
    { text: "$ ", tone: "symbol" },
  ]
}

export const promptText = (flavor: ShellFlavor, context: PromptContext) =>
  promptSegments(flavor, context)
    .map((segment) => segment.text)
    .join("")

/** The prompt of the landing-page terminal, which has no workspace open. */
export function entryPrompt(flavor: ShellFlavor, user: string) {
  if (flavor === "powershell") return "PS iterations:\\>"
  return flavor === "zsh" ? `${user}@iterations ~ %` : `${user}@iterations:~$`
}

/** The working directory, as `pwd` prints it. */
export function workingDirectory(
  flavor: ShellFlavor,
  { workspace, view }: PromptContext
) {
  const home = view === "terminal"
  return flavor === "powershell"
    ? `iterations:\\${workspace}${home ? "" : `\\${view}`}`
    : `/home/iterations/${workspace}${home ? "" : `/${view}`}`
}

/** What the terminal window's title bar says. */
export function windowTitle(flavor: ShellFlavor, context: PromptContext) {
  if (flavor === "powershell")
    return `PowerShell — ${workingDirectory(flavor, context)}`
  if (flavor === "zsh") return `${context.workspace} — -zsh`
  return `${context.user}@iterations: ~/${context.workspace}`
}

/** The prompt shown while a yes/no answer is pending. */
export function confirmPrompt(flavor: ShellFlavor) {
  return flavor === "powershell"
    ? '[Y] Yes  [N] No  (default is "N"): '
    : "Proceed? [y/N] "
}

/** The prompt shown during Ctrl+R history search. */
export function searchPrompt(flavor: ShellFlavor, query: string, found: boolean) {
  if (flavor === "bash")
    return `(${found ? "" : "failed "}reverse-i-search)\`${query}': `
  return `${found ? "" : "failing "}bck-i-search: ${query}_ `
}

export type BannerInfo = {
  version: string
  workspace: string
  tasks: number
  done: number
  incoming: number
  now?: Date
}

/** What the shell prints when it starts. */
export function banner(flavor: ShellFlavor, info: BannerInfo) {
  const summary = `${info.tasks} task${info.tasks === 1 ? "" : "s"}, ${info.done} done, ${info.incoming} incoming`
  if (flavor === "powershell")
    return [
      `Iterations PowerShell ${info.version}`,
      `Workspace: ${info.workspace} (${summary})`,
      "",
      "Type 'help' for commands. Tab completes, Ctrl+R searches history.",
    ].join("\n")
  const when = (info.now ?? new Date()).toString().slice(0, 24)
  if (flavor === "zsh")
    return [
      `Last login: ${when} on ttys000`,
      `iterations ${info.version} · ${info.workspace} · ${summary}`,
      "Type 'help' for commands. Tab completes, Ctrl+R searches history.",
    ].join("\n")
  return [
    `Welcome to iterations ${info.version} (${info.workspace} workspace)`,
    "",
    ` * Tasks:    ${summary}`,
    " * Commands: type 'help'. Tab completes, Ctrl+R searches history.",
    "",
    `Last login: ${when} from web`,
  ].join("\n")
}

// ---- Shell built-ins -------------------------------------------------------
// Commands about the terminal itself, not the workspace. Everything else goes
// to `execute` in lib/alpha.ts.

export type BuiltinContext = PromptContext & {
  flavor: ShellFlavor
  /** True when the shell follows the operating system. */
  automatic: boolean
  history: string[]
}
export type BuiltinResult = {
  output?: string
  exit?: boolean
  /** Switch shells; "auto" follows the operating system again. */
  shell?: ShellFlavor | "auto"
}

export function builtin(input: string, context: BuiltinContext): BuiltinResult | null {
  const [name = "", ...args] = input.trim().split(/\s+/)
  switch (name.toLowerCase()) {
    case "exit":
    case "quit":
      return { exit: true }
    case "pwd":
    case "get-location":
      return { output: workingDirectory(context.flavor, context) }
    case "whoami":
      return { output: context.user }
    case "history":
    case "get-history": {
      if (!context.history.length) return { output: "No commands yet." }
      const width = String(context.history.length).length
      return {
        output: context.history
          .map((line, i) => `${String(i + 1).padStart(width + 2)}  ${line}`)
          .join("\n"),
      }
    }
    case "shell": {
      const choice = args[0]?.toLowerCase()
      if (!choice)
        return {
          output: `${SHELL_TITLES[context.flavor]}${context.automatic ? " (matches this device)" : ""}\nSwitch with: shell auto|powershell|bash|zsh`,
        }
      if (choice === "auto") return { shell: "auto", output: "Shell follows this device." }
      if (isShell(choice))
        return { shell: choice, output: `Shell: ${SHELL_TITLES[choice]}.` }
      throw new Error("Use shell auto|powershell|bash|zsh.")
    }
  }
  return null
}

// ---- Line editing ----------------------------------------------------------

export type Line = { value: string; caret: number }
export type Edit =
  | "kill-to-start"
  | "kill-to-end"
  | "delete-word-back"
  | "delete-word-forward"
  | "word-back"
  | "word-forward"
  | "start"
  | "end"

const wordStart = (value: string, caret: number) => {
  let i = caret
  while (i > 0 && /\s/.test(value[i - 1])) i--
  while (i > 0 && !/\s/.test(value[i - 1])) i--
  return i
}
const wordEnd = (value: string, caret: number) => {
  let i = caret
  while (i < value.length && /\s/.test(value[i])) i++
  while (i < value.length && !/\s/.test(value[i])) i++
  return i
}

/** Readline-style editing of the line under the caret. */
export function editLine({ value, caret }: Line, edit: Edit): Line {
  switch (edit) {
    case "kill-to-start":
      return { value: value.slice(caret), caret: 0 }
    case "kill-to-end":
      return { value: value.slice(0, caret), caret }
    case "delete-word-back": {
      const start = wordStart(value, caret)
      return { value: value.slice(0, start) + value.slice(caret), caret: start }
    }
    case "delete-word-forward":
      return {
        value: value.slice(0, caret) + value.slice(wordEnd(value, caret)),
        caret,
      }
    case "word-back":
      return { value, caret: wordStart(value, caret) }
    case "word-forward":
      return { value, caret: wordEnd(value, caret) }
    case "start":
      return { value, caret: 0 }
    case "end":
      return { value, caret: value.length }
  }
}

// ---- History ---------------------------------------------------------------

/** Adds a command to the history, skipping an immediate repeat. */
export function remember(history: string[], command: string, limit = 200) {
  const line = command.trim()
  if (!line || history[history.length - 1] === line) return history
  return [...history, line].slice(-limit)
}

/**
 * Ctrl+R: the newest history entry containing `query`, looking only at entries
 * older than `before` (pass the previous match to step further back).
 * Returns -1 when nothing matches.
 */
export function searchHistory(
  history: string[],
  query: string,
  before = history.length
) {
  if (!query) return -1
  const needle = query.toLowerCase()
  for (let i = Math.min(before, history.length) - 1; i >= 0; i--)
    if (history[i].toLowerCase().includes(needle)) return i
  return -1
}

// ---- Syntax colouring ------------------------------------------------------

export type Token = {
  text: string
  kind: "command" | "unknown" | "subcommand" | "string" | "argument" | "space"
}

/** Splits a command line into coloured pieces; joined, they equal the input. */
export function highlight(
  input: string,
  registry: Record<string, CompletionCommand>
): Token[] {
  const tokens: Token[] = []
  let node: { sub_commands?: Record<string, CompletionCommand> } | undefined = {
    sub_commands: registry,
  }
  let first = true
  for (const [text] of input.matchAll(/\s+|"[^"]*"?|'[^']*'?|[^\s]+/g)) {
    if (/^\s/.test(text)) {
      tokens.push({ text, kind: "space" })
      continue
    }
    const key = text.toLowerCase()
    const next: CompletionCommand | undefined =
      node?.sub_commands && Object.hasOwn(node.sub_commands, key)
        ? node.sub_commands[key]
        : undefined
    if (next) tokens.push({ text, kind: first ? "command" : "subcommand" })
    else if (first) tokens.push({ text, kind: "unknown" })
    else
      tokens.push({ text, kind: /^["']/.test(text) ? "string" : "argument" })
    // Once a word is an argument, later words are arguments too.
    node = next
    first = false
  }
  return tokens
}
