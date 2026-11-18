"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import { VERSION } from "@/lib/alpha"
import {
  detectShell,
  entryBanner,
  entryPrompt,
  isShell,
  type ShellFlavor,
} from "@/lib/shell"
import ShellTerminal, { type LogEntry } from "./alpha/ShellTerminal"
import styles from "./entry-terminal.module.css"

const SHELL_COMMANDS: [string, string][] = [
  ["menu", "Show selectable actions"],
  ["clear", "Clear the output"],
  ["exit", "Close this terminal"],
]

const HELP = `login / register   Sign in or create an account here
workspace          Open the local alpha
dashboard          Open your account board
settings / logout  Account actions
menu               Show selectable actions
clear (cls)        Clear the output
exit               Close this terminal

↑ / ↓      choose an action (Alt+↑/↓ recall history) · Enter runs it
Tab        complete (again to cycle) · → accepts the suggestion
Ctrl+R     search history · Ctrl+L clear · Ctrl+C cancel · Esc clear the line
Esc on an empty line, or Ctrl+Y, closes this terminal.`

/**
 * The terminal on the landing page (Ctrl+Y): the same shell as the workspace
 * terminal, with a short list of actions to pick from and sign-in asked for
 * on the screen itself.
 */
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
  // The visitor's own shell, or the one they chose in the workspace. This
  // dialog only ever opens in the browser, so reading it here is safe.
  const [flavor] = useState<ShellFlavor>(() => {
    try {
      const chosen = window.localStorage.getItem("iterations:shell")
      if (isShell(chosen)) return chosen
    } catch {
      // Fall back to the device's shell.
    }
    return detectShell(navigator.platform || navigator.userAgent)
  })
  const name = user?.username?.trim().toLowerCase().replace(/\s+/g, "-") || "guest"
  const prompt = entryPrompt(flavor, name)
  const [input, setInput] = useState("")
  const [output, setOutput] = useState<LogEntry[]>(() => [
    {
      kind: "banner",
      text: entryBanner(flavor, VERSION, user?.username ?? null),
    },
  ])
  const [selected, setSelected] = useState(0)
  const [menu, setMenu] = useState(true)
  const [mode, setMode] = useState<"login" | "register" | null>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const promptField = useRef<HTMLInputElement>(null)
  const usernameField = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const options = ENTRY_COMMANDS.filter(
    (c) =>
      (!c.signedIn || !!user) &&
      (!user || !["login", "register"].includes(c.command))
  )
  const active = Math.min(selected, options.length - 1)
  // The list is for an empty prompt; once you type, completion takes over.
  const choosing = menu && !mode && !input
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
    for (const [command, usage] of SHELL_COMMANDS)
      commands[command] ??= { name: command, usage }
    return commands
  }, [signedIn])
  const completion = useCompletion(input, setInput, registry, undefined, !busy)
  const print = (...entries: LogEntry[]) =>
    setOutput((prev) => [...prev, ...entries].slice(-120))
  const write = (text: string) => print({ kind: "output", text })

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (mode) usernameField.current?.focus()
    else promptField.current?.focus()
  }, [mode])

  async function run(raw: string) {
    if (busy) return
    const command = parseEntryCommand(raw)
    setInput("")
    if (!command) {
      // Whatever followed the first word may be a password typed in the wrong
      // place, so it is not repeated on screen and never enters history.
      const [word = "", ...rest] = raw.trim().split(/\s+/)
      print(
        { kind: "command", prompt, text: rest.length ? `${word} …` : word },
        {
          kind: "error",
          text: "Command not recognized. Type help. Enter credentials only in the sign-in prompts.",
        }
      )
      return
    }
    // Only canonical commands enter history. Credentials and arbitrary arguments never do.
    remember(command)
    if (command === "clear") {
      setOutput([])
      setMenu(false)
      return
    }
    print({ kind: "command", prompt, text: command })
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
      write(HELP)
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
          print({
            kind: "error",
            text: err instanceof Error ? err.message : "Sign-out failed.",
          })
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
    print({ kind: "command", prompt, text: `${mode ? "" : input}^C`, plain: true })
    setMode(null)
    setPassword("")
    setConfirmation("")
    setUsername("")
    setError("")
    setInput("")
    setMenu(true)
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
          promptField.current?.focus()
        }}
        onEscapeKeyDown={(e) => {
          // Esc backs out one step at a time: the sign-in prompts, then the
          // typed line, and only then the terminal itself.
          if (mode) {
            e.preventDefault()
            cancel()
          } else if (input) {
            e.preventDefault()
            setInput("")
          }
        }}
        onKeyDown={(e) => {
          // Ctrl+C from the sign-in fields; the prompt handles its own.
          if (
            mode &&
            e.ctrlKey &&
            e.key.toLowerCase() === "c" &&
            !window.getSelection()?.toString()
          ) {
            e.preventDefault()
            cancel()
          }
        }}
      >
        <DialogTitle className="sr-only">Iterations terminal</DialogTitle>
        <DialogDescription className="sr-only">
          Select an action with arrow keys and Enter, or type a command. Sign in
          and create accounts inside the terminal.
        </DialogDescription>
        <ShellTerminal
          flavor={flavor}
          title={
            flavor === "powershell"
              ? "PowerShell — iterations:\\"
              : flavor === "zsh"
                ? "iterations — -zsh"
                : `${name}@iterations: ~`
          }
          status={user ? user.username : "GUEST"}
          prompt={prompt}
          entries={output}
          value={input}
          onChange={setInput}
          onSubmit={(line) => {
            const typed = line ?? input
            if (typed.trim()) void run(typed)
            else if (choosing) void run(options[active].command)
            else print({ kind: "command", prompt, text: "" })
          }}
          completion={completion}
          registry={registry}
          history={history}
          confirming={false}
          onClear={() => setOutput([])}
          onCancel={cancel}
          onExit={close}
          onClose={close}
          onArrow={(delta) => {
            if (!choosing) return false
            setSelected((active + delta + options.length) % options.length)
            return true
          }}
          inputRef={promptField}
          inputId="entry-command"
          disabled={busy}
          promptHidden={!!mode}
        >
          {choosing && (
            <div
              className={styles.choices}
              role="group"
              aria-label="Terminal actions"
            >
              <p>? What would you like to do?</p>
              {options.map((option, i) => (
                <button
                  key={option.command}
                  type="button"
                  className={i === active ? styles.chosen : ""}
                  disabled={busy}
                  tabIndex={-1}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => {
                    promptField.current?.focus()
                    void run(option.command)
                  }}
                >
                  <span aria-hidden="true">{i === active ? "❯" : " "}</span>
                  <b>{option.command}</b>
                  <span>
                    {option.title} · {option.description}
                  </span>
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
              <p>
                {mode === "login"
                  ? "Sign in to Iterations."
                  : "Create your Iterations account."}{" "}
                Passwords stay out of terminal history.
              </p>
              <label>
                <span>Username: </span>
                <input
                  ref={usernameField}
                  name="username"
                  autoComplete="username"
                  autoCapitalize="off"
                  spellCheck={false}
                  required
                  value={username}
                  disabled={busy}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label>
                <span>Password: </span>
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
                  <span>Confirm password: </span>
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
                      ? "[Enter] Sign in"
                      : "[Enter] Create account"}
                </button>
                <button type="button" onClick={cancel} disabled={busy}>
                  [Esc] Cancel
                </button>
              </div>
            </form>
          )}
        </ShellTerminal>
      </DialogContent>
    </Dialog>
  )
}
