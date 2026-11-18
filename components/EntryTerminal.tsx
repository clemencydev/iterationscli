"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useAuthenticate } from "@/hooks/use-authenticate"
import { ENTRY_COMMANDS, parseEntryCommand } from "@/lib/entry-terminal"
import { Commands } from "@/contexts/TerminalContext/commands"
import { useCompletion } from "@/hooks/use-completion"
import type { CompletionCommand } from "@/lib/completion"
import { detectShell, entryPrompt, isShell } from "@/lib/shell"
import styles from "./entry-terminal.module.css"

const SHELL_COMMANDS: [string, string][] = [
  ["menu", "Show selectable actions"],
  ["clear", "Clear the output"],
  ["exit", "Close this terminal"],
]

export default function EntryTerminal({
  close,
  openSettings,
  history,
  remember,
}: {
  close: () => void
  openSettings: () => void
  history: string[]
  remember: (command: string) => void
}) {
  const { user, checkSession } = useAuthenticate()
  const router = useRouter()
  // The prompt of the visitor's own shell (or the one they chose in the
  // workspace). This dialog only opens in the browser, so reading it here is safe.
  const [promptLabel] = useState(() => {
    let chosen: string | null = null
    try {
      chosen = window.localStorage.getItem("iterations:shell")
    } catch {
      // Fall back to the device's shell.
    }
    return entryPrompt(
      isShell(chosen)
        ? chosen
        : detectShell(navigator.platform || navigator.userAgent),
      "guest"
    )
  })
  const [input, setInput] = useState("")
  const [output, setOutput] = useState<string[]>([
    "IterationsCLI [alpha 0.1.0]",
    "Choose an option below, or type a command. Type help to explore.",
  ])
  const [selected, setSelected] = useState(0)
  const [menu, setMenu] = useState(true)
  const [mode, setMode] = useState<"login" | "register" | null>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const prompt = useRef<HTMLInputElement>(null)
  const usernameField = useRef<HTMLInputElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const position = useRef(history.length)
  const request = useRef<AbortController | null>(null)
  const options = ENTRY_COMMANDS.filter(
    (c) =>
      (!c.signedIn || !!user) &&
      (!user || !["login", "register"].includes(c.command))
  )
  const active = Math.min(selected, options.length - 1)
  // What Tab can complete: the command registry (including "auth" and its
  // subcommands) plus the actions available to this session.
  const signedIn = !!user
  const registry = useMemo(() => {
    const commands: Record<string, CompletionCommand> = { ...Commands }
    for (const option of ENTRY_COMMANDS)
      if (
        (!option.signedIn || signedIn) &&
        (!signedIn || !["login", "register"].includes(option.command))
      )
        commands[option.command] ??= {
          name: option.command,
          usage: option.title,
        }
    for (const [name, usage] of SHELL_COMMANDS) commands[name] ??= { name, usage }
    return commands
  }, [signedIn])
  const completion = useCompletion(input, setInput, registry, undefined, !busy)
  const write = (text: string) =>
    setOutput((prev) => [...prev, text].slice(-80))

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" })
  }, [output])
  useEffect(() => {
    if (mode) usernameField.current?.focus()
    else prompt.current?.focus()
  }, [mode])

  async function run(raw: string) {
    if (busy) return
    const command = parseEntryCommand(raw)
    setInput("")
    if (!command) {
      write(
        "Command not recognized. Type help. Enter credentials only in the sign-in prompts."
      )
      return
    }
    // Only canonical commands enter history. Credentials and arbitrary arguments never do.
    remember(command)
    position.current = Math.min(history.length + 1, 100)
    if (command === "clear") {
      setOutput([])
      setMenu(false)
      return
    }
    write(`${promptLabel} ${command}`)
    if (command === "exit") {
      close()
      return
    }
    if (command === "menu") {
      setMenu(true)
      setSelected(0)
      return
    }
    if (command === "help") {
      write(
        "login / register   Sign in or create an account here\nworkspace          Open the local alpha\ndashboard          Open your account board\nsettings / logout  Account actions\nmenu               Show selectable actions\nclear (cls)        Clear the output\nexit               Close this terminal\n\n↑/↓ select actions · Enter runs · Tab completes (again to cycle) · → accepts the suggestion\nAlt+↑/↓ recall history · Ctrl+L clears · Ctrl+C cancels\nEsc or Ctrl+Y closes. This prompt runs Iterations commands."
      )
      return
    }
    if (command === "login" || command === "register") {
      if (user) {
        write("Already signed in. Use dashboard or logout.")
        return
      }
      setMode(command)
      setMenu(false)
      setError("")
      return
    }
    if (command === "workspace") {
      close()
      router.push("/alpha")
      return
    }
    if (!user) {
      write(
        "Sign in first with login, or use workspace to try the local alpha."
      )
      return
    }
    if (command === "dashboard") {
      close()
      router.push("/dashboard")
      return
    }
    if (command === "settings") {
      openSettings()
      return
    }
    if (command === "logout") {
      setBusy(true)
      const controller = new AbortController()
      request.current = controller
      try {
        const res = await fetch("/api/auth/sign-out", {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error("Sign-out failed. Please try again.")
        await checkSession?.()
        write("Signed out.")
        setSelected(0)
      } catch (err) {
        if (!controller.signal.aborted)
          write(err instanceof Error ? err.message : "Sign-out failed.")
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    }
  }

  async function authenticate() {
    if (!mode || busy) return
    if (mode === "register" && password !== confirmation) {
      setError("Passwords do not match.")
      return
    }
    setBusy(true)
    setError("")
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), 20000)
    try {
      const res = await fetch(
        mode === "login" ? "/api/auth/sign-in" : "/api/auth/sign-up",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.trim(), password }),
          signal: controller.signal,
        }
      )
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(
          typeof body?.message === "string"
            ? body.message
            : "Unable to authenticate. Please try again."
        )
        return
      }
      setPassword("")
      setConfirmation("")
      setUsername("")
      await checkSession?.()
      write(
        mode === "register"
          ? "Account created. Choose dashboard for your account board or workspace for the local alpha."
          : "Signed in. Choose dashboard for your account board or workspace for the local alpha."
      )
      setMode(null)
      setMenu(true)
      setSelected(0)
    } catch {
      setError("Could not reach the sign-in service. Please try again.")
    } finally {
      clearTimeout(timeout)
      setPassword("")
      setConfirmation("")
      setBusy(false)
    }
  }

  function cancel() {
    if (busy) return
    setMode(null)
    setPassword("")
    setConfirmation("")
    setUsername("")
    setError("")
    setInput("")
    setMenu(true)
    write("^C  Cancelled.")
  }
  function keys(e: KeyboardEvent<HTMLInputElement>) {
    if (completion.onKeyDown(e)) return
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      const delta = e.key === "ArrowUp" ? -1 : 1
      if (e.altKey || input || !menu) {
        position.current = Math.max(
          0,
          Math.min(history.length, position.current + delta)
        )
        setInput(history[position.current] ?? "")
      } else setSelected((active + delta + options.length) % options.length)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        className={styles.window}
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          prompt.current?.focus()
        }}
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key.toLowerCase() === "l") {
            e.preventDefault()
            setOutput([])
          }
          if (
            e.ctrlKey &&
            e.key.toLowerCase() === "c" &&
            !window.getSelection()?.toString()
          ) {
            e.preventDefault()
            cancel()
          }
        }}
      >
        <header className={styles.titlebar}>
          <DialogTitle className={styles.title}>
            <span aria-hidden="true">&gt;_</span> Iterations terminal
          </DialogTitle>
          <button onClick={close} aria-label="Close terminal">
            ×
          </button>
        </header>
        <DialogDescription className="sr-only">
          Select an action with arrow keys and Enter, or type a command. Sign in
          and create accounts inside the terminal.
        </DialogDescription>
        <div className={styles.screen}>
          <div
            role="log"
            aria-label="Terminal output"
            className={styles.output}
          >
            {output.map((line, i) => (
              <pre key={i}>{line}</pre>
            ))}
            <div ref={end} />
          </div>
          {!mode && menu && (
            <div
              className={styles.menu}
              role="group"
              aria-label="Terminal actions"
            >
              {options.map((option, i) => (
                <button
                  key={option.command}
                  className={i === active ? styles.selected : ""}
                  disabled={busy}
                  onFocus={() => setSelected(i)}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => void run(option.command)}
                >
                  <span aria-hidden="true">{i === active ? ">" : " "}</span>
                  <span>
                    {option.title}
                    <small>{option.description}</small>
                  </span>
                  <code>{option.command}</code>
                </button>
              ))}
            </div>
          )}
          {mode && (
            <form
              className={styles.auth}
              onSubmit={(e) => {
                e.preventDefault()
                void authenticate()
              }}
            >
              <h2>
                {mode === "login"
                  ? "Sign in to Iterations"
                  : "Create your account"}
              </h2>
              <p>
                Enter your credentials below. Passwords stay out of terminal
                history.
              </p>
              <label>
                Username
                <input
                  ref={usernameField}
                  name="username"
                  autoComplete="username"
                  required
                  value={username}
                  disabled={busy}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {mode === "register" && (
                <label>
                  Confirm password
                  <input
                    name="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    disabled={busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
              )}
              {error && (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              )}
              <div className={styles.actions}>
                <button type="submit" disabled={busy}>
                  {busy
                    ? "Connecting…"
                    : mode === "login"
                      ? "Sign in ↵"
                      : "Create account ↵"}
                </button>
                <button type="button" onClick={cancel} disabled={busy}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
        {!mode && completion.candidates.length > 0 && (
          <div
            className={styles.suggestions}
            role="listbox"
            aria-label="Completions"
          >
            {completion.candidates.slice(0, 6).map((c, i) => (
              <button
                type="button"
                role="option"
                key={c.value}
                aria-selected={i === completion.active}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  completion.accept(c.value)
                  prompt.current?.focus()
                }}
              >
                <b>{c.value}</b>
                {c.description && <span>{c.description}</span>}
              </button>
            ))}
          </div>
        )}
        {!mode && (
          <form
            className={styles.prompt}
            onSubmit={(e) => {
              e.preventDefault()
              if (input.trim()) void run(input)
              else if (menu) void run(options[active].command)
            }}
          >
            <label htmlFor="entry-command">{promptLabel}</label>
            <div className={styles.field}>
              <div className={styles.ghost} aria-hidden="true">
                <span>{input}</span>
                {completion.suggestion}
              </div>
              <input
              ref={prompt}
              id="entry-command"
              aria-label="Terminal command"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={keys}
              placeholder={
                busy
                  ? "Connecting…"
                  : menu
                    ? `${options[active].command} · Enter to select`
                    : "Type a command…"
              }
            />
            </div>
            <button disabled={busy} aria-label="Run command">
              ↵
            </button>
          </form>
        )}
        <footer className={styles.footer}>
          <span>
            {user ? `Signed in as ${user.username}` : "Guest session"}
          </span>
          <span>↑↓ select · Tab complete · → accept · Ctrl+Y close</span>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
