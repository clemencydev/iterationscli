"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
} from "react"
import {
  addColumn,
  addPaletteColor,
  addTask,
  addWhiteboardObject,
  resolveArrow,
  deleteLabel,
  deleteTask,
  deleteColumn,
  checkpoint,
  DEFAULT_PALETTE,
  boardNeighbour,
  describeObject,
  drawingGroups,
  execute,
  lineEnds,
  linkItems,
  linkSymbol,
  HELP,
  initialWorkspace,
  isHexColor,
  isWorkspace,
  linkObjectToTask,
  ticketCanvasItems,
  mergeProposal,
  normalizeWorkspace,
  parseProposals,
  removePaletteColor,
  renameColumn,
  revert,
  setLabelColor,
  THEMES,
  uid,
  updateTask,
  VERSION,
  VIEWS,
  type CommandResult,
  type Label,
  type Task,
  type View,
  type Workspace as WorkspaceData,
} from "@/lib/alpha"
import {
  familyFromFile,
  isFontFile,
  MAX_FONT_BYTES,
  parseGoogleFont,
  type SavedFont,
} from "@/lib/font"
import { applyFont, readSavedFont, saveFont } from "@/lib/font-client"
import { WorkspaceCommands } from "@/contexts/TerminalContext/commands"
import { useCompletion } from "@/hooks/use-completion"
import { useWorkspaceSync, type SyncStatus } from "@/hooks/use-workspace-sync"
import type { Sources } from "@/lib/completion"
import styles from "./workspace.module.css"
import { useTheme } from "next-themes"
import Link from "next/link"
import Whiteboard from "./Whiteboard"
import { applySelection } from "@/lib/canvas-selection"
import Menu from "./Menu"
import TrendChart from "./TrendChart"
import ShellTerminal, { type LogEntry } from "./ShellTerminal"
import { Divider, PaneChooser, PaneTree, VIEW_DRAG } from "./Panes"
import {
  closePane,
  findBlank,
  findLeaf,
  findView,
  isLayout,
  leaf,
  leaves,
  nextLeaf,
  onlyPane,
  placeView,
  resizeSplit,
  setView as setPaneView,
  splitPane,
  type Pane,
  type Zone,
} from "@/lib/panes"
import { useAuthenticate } from "@/hooks/use-authenticate"
import {
  banner,
  builtin,
  confirmPrompt,
  detectShell,
  isShell,
  promptSegments,
  remember,
  SHELL_TITLES,
  windowTitle,
  type ShellFlavor,
} from "@/lib/shell"

const STORAGE = "iterationscli.alpha.v1"
const names: Record<View, string> = {
  terminal: "Terminal",
  board: "Task board",
  canvas: "Canvas",
  stats: "Statistics",
  inbox: "Incoming",
  history: "History",
  settings: "Customize",
}
const icons: Record<View, string> = {
  terminal: ">_",
  board: "▤",
  canvas: "✳",
  stats: "▥",
  inbox: "↓",
  history: "↶",
  settings: "◐",
}
const syncText: Record<SyncStatus, string> = {
  checking: "Autosave enabled · checking account sync…",
  local: "Autosave enabled · local workspace",
  "signed-out": "Autosave enabled · local workspace · sign in to sync",
  synced: "Autosave enabled · synced to your account",
  saving: "Saving to your account…",
  error: "Saved in this browser · account sync is unavailable right now",
}
const stamp = (w: WorkspaceData): WorkspaceData => ({
  ...w,
  updated: new Date().toISOString(),
})
const SHELL_STORAGE = "iterations:shell"
const HISTORY_STORAGE = "iterations:history"
const LAYOUT_STORAGE = "iterations:layout"
const labelStyle = (label: Label) =>
  ({ "--label": label.color }) as CSSProperties

export default function Workspace() {
  const { resolvedTheme, setTheme } = useTheme()
  const [w, setW] = useState<WorkspaceData>(initialWorkspace)
  const [ready, setReady] = useState(false)
  const [storageError, setStorageError] = useState("")
  // Undo and redo: workspaces as they were before and after each change.
  const past = useRef<WorkspaceData[]>([])
  const future = useRef<WorkspaceData[]>([])
  const lastChange = useRef(0)
  // The views on screen: a tree of panes (lib/panes.ts) and the one the
  // keyboard belongs to. Each view is shown at most once.
  const [layout, setLayout] = useState<Pane<View>>(() =>
    leaf<View>("terminal", "main")
  )
  const [focus, setFocus] = useState("main")
  /** A view being dragged from the sidebar, a tab or a pane's bar. */
  const [dragView, setDragView] = useState<View | null>(null)
  /** Share of the width the panes keep when a ticket or docked terminal sits beside them. */
  const [sideRatio, setSideRatio] = useState(0.62)
  /** The view the terminal last `cd`-ed to. */
  const [cwd, setCwd] = useState<View | null>(null)
  /** The ticket the arrow keys are on, on the task board. */
  const [boardCursor, setBoardCursor] = useState<string | null>(null)
  /** Pane to move keyboard focus into once it has rendered. */
  const pendingFocus = useRef<string | null>(null)
  const panes = leaves(layout)
  const focused = findLeaf(layout, focus) ?? panes[0]
  /** The view the keyboard is in; an empty pane counts as its neighbour. */
  const view: View =
    focused.view ?? panes.find((pane) => pane.view)?.view ?? "terminal"
  const [tabs, setTabs] = useState<View[]>(["terminal"])
  const [splitTask, setSplitTask] = useState<string | null>(null)
  const [boardCamera, setBoardCamera] = useState({ x: 0, y: 0, zoom: 1 })
  const boardSize = useRef({ width: 1000, height: 600 })
  const boardCenter = () => ({
    x: (boardSize.current.width / 2 - boardCamera.x) / boardCamera.zoom,
    y: (boardSize.current.height / 2 - boardCamera.y) / boardCamera.zoom,
  })
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalMode, setTerminalMode] = useState<
    "modal" | "floating" | "split"
  >("modal")
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [terminalPosition, setTerminalPosition] = useState({ x: 80, y: 80 })
  const floatingTerminal = useRef<HTMLDivElement>(null)
  const terminalDrag = useRef<{
    x: number
    y: number
    left: number
    top: number
  } | null>(null)
  const cycleTerminalMode = () => {
    setTerminalMode((mode) =>
      mode === "modal" ? "floating" : mode === "floating" ? "split" : "modal"
    )
    setTerminalOpen(true)
  }
  const terminalDialog = useRef<HTMLDialogElement>(null)
  const mainPrompt = useRef<HTMLInputElement>(null)
  const popupPrompt = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [canvasFocus, setCanvasFocus] = useState<{
    id: string
    request: number
  } | null>(null)
  const [confirm, setConfirm] = useState<CommandResult["confirm"]>()
  const reviewedState = useRef<WorkspaceData | null>(null)
  const [command, setCommand] = useState("")
  const [log, setLog] = useState<LogEntry[]>([])
  const [commands, setCommands] = useState<string[]>([])
  // The terminal dresses as the shell of the visitor's operating system
  // unless they picked one with the `shell` command.
  const [shellChoice, setShellChoice] = useState<ShellFlavor | "auto">("auto")
  const [deviceShell, setDeviceShell] = useState<ShellFlavor>("bash")
  const shell = shellChoice === "auto" ? deviceShell : shellChoice
  const { user } = useAuthenticate() ?? {}
  const [query, setQuery] = useState("")
  const [labelFilter, setLabelFilter] = useState("")
  const [needsSubmission, setNeedsSubmission] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [pendingJson, setPendingJson] = useState("")
  const [font, setFont] = useState<SavedFont | null>(null)
  const [fontInput, setFontInput] = useState("")
  const [fontMessage, setFontMessage] = useState("")
  const [fontBusy, setFontBusy] = useState(false)

  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setFont(readSavedFont())
      const device = detectShell(
        (navigator as { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ||
          navigator.platform ||
          navigator.userAgent
      )
      setDeviceShell(device)
      let flavor = device
      try {
        const chosen = localStorage.getItem(SHELL_STORAGE)
        if (isShell(chosen)) {
          setShellChoice(chosen)
          flavor = chosen
        }
        const past: unknown = JSON.parse(
          localStorage.getItem(HISTORY_STORAGE) ?? "[]"
        )
        if (Array.isArray(past))
          setCommands(
            past.filter((line) => typeof line === "string").slice(-200)
          )
        const saved: unknown = JSON.parse(
          localStorage.getItem(LAYOUT_STORAGE) ?? "null"
        )
        if (isLayout(saved, VIEWS)) {
          const shown = leaves(saved)
          setLayout(saved)
          setFocus(shown[0].id)
          setTabs(shown.flatMap((pane) => (pane.view ? [pane.view] : [])))
        }
      } catch {
        // No saved shell, history or layout: start fresh.
      }
      try {
        const raw = localStorage.getItem(STORAGE)
        let loaded = initialWorkspace()
        if (raw) {
          const saved: unknown = JSON.parse(raw)
          if (!isWorkspace(saved)) throw new Error("Invalid saved workspace")
          loaded = normalizeWorkspace(saved)
          setW(loaded)
        }
        setLog([
          {
            kind: "banner",
            text: banner(flavor, {
              version: VERSION,
              workspace: "personal",
              tasks: loaded.tasks.length,
              done: loaded.tasks.filter((t) => t.done).length,
              incoming: loaded.proposals.length,
            }),
          },
        ])
        setReady(true)
      } catch {
        setStorageError(
          "Saved workspace could not be loaded. Recover your browser data before clearing storage; autosave is disabled."
        )
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(STORAGE, JSON.stringify(w))
    } catch {
      const timer = setTimeout(
        () =>
          setStorageError(
            "Browser storage is full or unavailable. Export a backup now; recent changes may not survive a reload."
          ),
        0
      )
      return () => clearTimeout(timer)
    }
  }, [w, ready])
  // Mirrors the workspace to the signed-in account when Supabase is configured;
  // otherwise this stays "local" and browser storage is the only copy.
  const sync = useWorkspaceSync(w, ready, setW)
  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(HISTORY_STORAGE, JSON.stringify(commands))
    } catch {
      // History is a convenience; losing it is fine.
    }
  }, [commands, ready])
  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(LAYOUT_STORAGE, JSON.stringify(layout))
    } catch {
      // The layout is rebuilt in a few keystrokes.
    }
  }, [layout, ready])
  // After a pane is opened or switched to from the keyboard, put the keyboard
  // in it: the prompt for the terminal, the first control anywhere else.
  useEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    pendingFocus.current = null
    const pane = document.querySelector<HTMLElement>(`[data-pane="${id}"]`)
    if (!pane) return
    const target =
      pane.querySelector<HTMLElement>("#alpha-command") ??
      pane.querySelector<HTMLElement>("[data-option]") ??
      pane.querySelector<HTMLElement>("[data-keys]") ??
      pane
    target.focus({ preventScroll: true })
  })
  useEffect(() => {
    if (terminalOpen && terminalMode === "modal") {
      terminalDialog.current?.showModal()
    } else terminalDialog.current?.close()
    if (terminalOpen) popupPrompt.current?.focus()
  }, [terminalOpen, terminalMode])
  useEffect(() => {
    const clamp = () => {
      const rect = floatingTerminal.current?.getBoundingClientRect()
      if (!rect) return
      setTerminalPosition((p) => ({
        x: Math.max(0, Math.min(p.x, window.innerWidth - rect.width)),
        y: Math.max(0, Math.min(p.y, window.innerHeight - 48)),
      }))
    }
    const frame = requestAnimationFrame(clamp)
    window.addEventListener("resize", clamp)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", clamp)
    }
  }, [terminalOpen, terminalMode])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!ready || event.defaultPrevented) return
      // Undo, redo, splitting and moving between panes (these may repeat, and
      // on a Mac they use ⌘).
      if (!event.altKey && keys.current.pane(event)) return
      if (event.repeat || event.altKey || event.metaKey) return
      if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault()
        setSelected(null)
        setTerminalOpen((open) => !open)
        return
      }
      // Ctrl+` puts the keyboard back at the prompt from anywhere.
      if (event.ctrlKey && event.key === "`") {
        event.preventDefault()
        if (terminalOpen) popupPrompt.current?.focus()
        else keys.current.terminal()
        return
      }
      const typing =
        event.target instanceof HTMLElement &&
        !!event.target.closest(
          "input,textarea,select,[contenteditable=true],[role=textbox]"
        )
      if (!typing && !event.ctrlKey && event.key.toLowerCase() === "m") {
        event.preventDefault()
        setTerminalMode((mode) =>
          mode === "modal"
            ? "floating"
            : mode === "floating"
              ? "split"
              : "modal"
        )
        setTerminalOpen(true)
      }
      if (!typing && !event.ctrlKey && event.key === "Tab" && !event.shiftKey) {
        event.preventDefault()
        setSidebarHidden((hidden) => !hidden)
      }
      if (event.key === "Escape" && terminalOpen && terminalMode !== "modal") {
        event.preventDefault()
        setTerminalOpen(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [ready, terminalOpen, terminalMode])
  useEffect(() => {
    if (selected) dialog.current?.showModal()
    else dialog.current?.close()
  }, [selected])

  /**
   * Every edit to the workspace goes through here so it can be undone. Edits
   * that follow each other closely (a drag, a burst of typing) are one step.
   */
  const commit = (next: WorkspaceData) => {
    const now = Date.now()
    if (now - lastChange.current > 600 || !past.current.length)
      past.current = [...past.current, w].slice(-100)
    lastChange.current = now
    future.current = []
    setW(stamp(next))
  }
  /** Steps back (undo) or forward (redo). Returns false at either end. */
  const travel = (direction: "undo" | "redo") => {
    const from = direction === "undo" ? past : future
    const to = direction === "undo" ? future : past
    const target = from.current[from.current.length - 1]
    if (!target) return false
    from.current = from.current.slice(0, -1)
    to.current = [...to.current, w]
    // The next edit starts a step of its own.
    lastChange.current = 0
    setW(stamp(target))
    return true
  }

  const change = (
    fn: (current: WorkspaceData) => WorkspaceData,
    message?: string
  ) => {
    try {
      const next = fn(w)
      if (next !== w) commit(next)
      if (message) setNotice(message)
      return true
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Something went wrong."
      )
      return false
    }
  }
  const addTab = (next: View) =>
    setTabs((prev) => (prev.includes(next) ? prev : [...prev, next]))
  /** Moves the keyboard to a pane (and, once rendered, into it). */
  const focusPane = (id: string) => {
    pendingFocus.current = id
    setFocus(id)
  }
  /**
   * Shows a view: the pane already showing it gets the keyboard, otherwise it
   * replaces what the focused pane shows.
   */
  const open = (next: View) => {
    const shown = findView(layout, next)
    if (shown) focusPane(shown.id)
    else {
      setLayout(setPaneView(layout, focused.id, next))
      pendingFocus.current = focused.id
    }
    addTab(next)
  }
  /**
   * Splits a pane (the focused one unless `target` is given). With a view it
   * opens beside the pane; without, an empty pane asks what to open. "row"
   * puts the new pane to the right, "column" below.
   */
  const splitWith = (
    direction: "row" | "column",
    next: View | null,
    { target = focused.id, keepFocus = false } = {}
  ) => {
    const side = direction === "row" ? "right" : "bottom"
    if (next === null) {
      // One empty pane at a time: asking twice goes back to the first.
      const blank = findBlank(layout)
      if (blank) return focusPane(blank.id)
      const added = leaf<View>(null)
      setLayout(splitPane(layout, target, side, added))
      return focusPane(added.id)
    }
    const placed = placeView(layout, next, target, side)
    setLayout(placed.layout)
    addTab(next)
    if (!keepFocus) focusPane(placed.id)
  }
  const closePaneById = (id: string) => {
    if (panes.length < 2) return false
    const index = panes.findIndex((pane) => pane.id === id)
    const next = closePane(layout, id)
    setLayout(next)
    if (focus === id) {
      const rest = leaves(next)
      focusPane(rest[Math.min(index, rest.length - 1)].id)
    }
    return true
  }
  const dropView = (target: string, zone: Zone) => {
    if (!dragView) return
    const placed = placeView(layout, dragView, target, zone)
    setLayout(placed.layout)
    addTab(dragView)
    focusPane(placed.id)
    setDragView(null)
  }
  const closeTab = (tab: View) => {
    const index = tabs.indexOf(tab)
    const rest = tabs.filter((t) => t !== tab)
    if (!rest.length) return
    setTabs(rest)
    const shown = findView(layout, tab)
    if (!shown) return
    // With other panes around the pane goes; the last pane shows another tab.
    if (!closePaneById(shown.id))
      setLayout(setPaneView(layout, shown.id, rest[Math.max(0, index - 1)]))
  }
  /** What a draggable view (sidebar entry, tab) needs to be dropped on a pane. */
  const dragProps = (dragged: View) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(VIEW_DRAG, dragged)
      event.dataTransfer.effectAllowed = "move"
      setDragView(dragged)
    },
    onDragEnd: () => setDragView(null),
  })
  const undo = () => {
    const done = travel("undo")
    setNotice(done ? "Undone. Ctrl+Shift+Z redoes." : "Nothing to undo.")
    return done
  }
  const redo = () => {
    const done = travel("redo")
    setNotice(done ? "Redone." : "Nothing to redo.")
    return done
  }
  // Workspace-wide keys. The listener is registered once, so it reaches the
  // current state through this ref.
  const keys = useRef({
    terminal: () => {},
    pane: (() => false) as (event: KeyboardEvent) => boolean,
  })
  useEffect(() => {
    keys.current = {
      terminal: () => open("terminal"),
      pane: (event) => {
        const key = event.key.toLowerCase()
        const target = event.target as HTMLElement | null
        const typing = !!target?.closest?.(
          "input,textarea,select,[contenteditable=true],[role=textbox]"
        )
        // An empty prompt has nothing of its own to undo.
        const emptyPrompt =
          target instanceof HTMLInputElement &&
          !target.value &&
          (target.id === "alpha-command" ||
            target.id === "workspace-popup-command")
        const mod = event.ctrlKey || event.metaKey
        if (mod && key === "z" && (!typing || emptyPrompt)) {
          event.preventDefault()
          if (event.shiftKey) redo()
          else undo()
          return true
        }
        if (event.repeat) return false
        if (mod && event.code === "Backslash") {
          event.preventDefault()
          splitWith(event.shiftKey ? "column" : "row", null)
          return true
        }
        if (event.key === "F6") {
          event.preventDefault()
          focusPane(nextLeaf(layout, focused.id, event.shiftKey ? -1 : 1).id)
          return true
        }
        if (typing || mod || event.shiftKey) return false
        if (key === "v" || key === "h") {
          event.preventDefault()
          splitWith(key === "v" ? "row" : "column", null)
          return true
        }
        if (key === "x" && panes.length > 1) {
          event.preventDefault()
          closePaneById(focused.id)
          return true
        }
        return false
      },
    }
  })
  const completed = w.tasks.filter((t) => t.done).length
  const pending = w.tasks.filter((t) => t.done && t.submission === "pending")
  const task = w.tasks.find((t) => t.id === selected)
  const paneTask = w.tasks.find((t) => t.id === splitTask)
  const palette = w.palette ?? DEFAULT_PALETTE
  const penColor =
    w.penColor ?? (isHexColor(w.accent) ? w.accent : DEFAULT_PALETTE[0])

  // Live values the terminal can complete: IDs are shown as the 8-character
  // prefixes the commands accept.
  const sources = useMemo<Sources>(
    () => ({
      task: w.tasks.map((t) => ({
        value: t.id.slice(0, 8),
        description: t.title,
      })),
      column: w.columns,
      label: w.labels.map((l) => l.name),
      checkpoint: [...w.commits].reverse().map((c) => ({
        value: c.id.slice(0, 8),
        description: c.message,
      })),
      proposal: w.proposals.map((p) => ({ value: p.id, description: p.title })),
      // What `link` can connect, each with enough words to tell them apart.
      object: w.objects
        .filter((o) => o.kind !== "arrow")
        .map((o) => ({
          value: o.id.slice(0, 8),
          description: describeObject(o, w),
        })),
      arrow: w.objects
        .filter((o) => o.kind === "arrow")
        .map((o) => ({
          value: o.id.slice(0, 8),
          description: `${o.from?.objectId.slice(0, 8) ?? "loose"} ${linkSymbol(lineEnds(o))} ${o.to?.objectId.slice(0, 8) ?? "loose"}${o.text ? ` "${o.text}"` : ""}`,
        })),
      drawing: drawingGroups(w).map((g) => ({
        value: g.id.slice(0, 8),
        description: `${g.name} (${g.strokes.length} strokes)`,
      })),
    }),
    [w]
  )
  const completion = useCompletion(
    command,
    setCommand,
    WorkspaceCommands,
    sources,
    !confirm
  )

  const promptContext = {
    user: user?.username?.trim().toLowerCase().replace(/\s+/g, "-") || "you",
    workspace: "personal",
    // Where the prompt says you are: the view last `cd`-ed to while it is
    // still open, or the view a terminal window is floating over.
    view:
      cwd && findView(layout, cwd)
        ? cwd
        : terminalOpen && view !== "terminal"
          ? view
          : "terminal",
  }
  const prompt = promptSegments(shell, promptContext)
  const print = (...entries: LogEntry[]) =>
    setLog((prev) => [...prev, ...entries].slice(-400))
  const chooseShell = (choice: ShellFlavor | "auto") => {
    setShellChoice(choice)
    try {
      if (choice === "auto") localStorage.removeItem(SHELL_STORAGE)
      else localStorage.setItem(SHELL_STORAGE, choice)
    } catch {
      // The choice still holds until the page is closed.
    }
  }

  const submitCommand = (event?: FormEvent, override?: string) => {
    event?.preventDefault()
    const input = (override ?? command).trim()
    setCommand("")
    // The line as it was typed, behind the prompt it was typed at.
    const echo: LogEntry = {
      kind: "command",
      prompt: confirm ? [{ text: confirmPrompt(shell) }] : prompt,
      text: input,
      plain: !!confirm,
    }
    const say = (text: string) => print(echo, { kind: "output", text })
    if (!input) return print(echo)
    try {
      if (confirm) {
        if (!/^[yn]$/i.test(input))
          throw new Error(
            "A review is pending. Enter Y to confirm or N to cancel."
          )
        if (input.toLowerCase() === "y") {
          if (reviewedState.current !== w) {
            setConfirm(undefined)
            throw new Error(
              "The workspace changed since review. Review the merge or restore again before confirming."
            )
          }
          commit(
            confirm.type === "merge"
              ? mergeProposal(w, confirm.id)
              : revert(w, confirm.id)
          )
        }
        setConfirm(undefined)
        return say(
          input.toLowerCase() === "y" ? "Applied. History updated." : "Cancelled."
        )
      }
      setCommands((prev) => remember(prev, input))
      const own = builtin(input, {
        ...promptContext,
        flavor: shell,
        automatic: shellChoice === "auto",
        history: commands,
      })
      if (own?.exit) {
        if (!terminalOpen)
          return say(
            "This is the workspace's own terminal, so there is nothing to exit to. Ctrl+Y opens a terminal window you can close."
          )
        setTerminalOpen(false)
        return print(echo)
      }
      if (own?.shell) {
        chooseShell(own.shell)
        // A new shell greets you the way that shell does.
        const next = own.shell === "auto" ? deviceShell : own.shell
        return say(
          banner(next, {
            version: VERSION,
            workspace: "personal",
            tasks: w.tasks.length,
            done: w.tasks.filter((t) => t.done).length,
            incoming: w.proposals.length,
          })
        )
      }
      if (own) return say(own.output ?? "")
      if (/^(undo|redo)$/i.test(input)) {
        const which = input.toLowerCase() as "undo" | "redo"
        return say(
          travel(which)
            ? which === "undo"
              ? "Undone. `redo` (Ctrl+Shift+Z) brings it back."
              : "Redone."
            : `Nothing to ${which}.`
        )
      }
      const result = execute(w, input, boardCenter())
      if (result.workspace !== w) commit(result.workspace)
      let said = result.output
      // From the workspace's own terminal the keyboard stays at the prompt; a
      // terminal window floats over the views, so there the view just opens.
      const here = !terminalOpen && focused.view === "terminal"
      if (result.view) {
        // `tab` asks to go there. Anything else (adding to the canvas, say)
        // only wants the view on screen, so it opens beside the terminal.
        if (here && !/^tab\b/i.test(input)) {
          if (!findView(layout, result.view))
            splitWith("row", result.view, { keepFocus: true })
        } else open(result.view)
      }
      if (result.go) {
        if (result.go === "terminal") setCwd(null)
        else {
          if (!findView(layout, result.go)) {
            if (here) splitWith("row", result.go, { keepFocus: true })
            else open(result.go)
          }
          setCwd(result.go)
        }
      }
      if (result.pane?.op === "split") {
        splitWith(result.pane.direction, result.pane.view, { keepFocus: here })
        said = result.pane.view
          ? `${names[result.pane.view]} opened ${result.pane.direction === "row" ? "beside" : "below"} this pane.`
          : "New pane: pick what to open."
      }
      if (result.pane?.op === "close") {
        const shown = findView(layout, result.pane.view)
        said = !shown
          ? `${names[result.pane.view]} is not open.`
          : closePaneById(shown.id)
            ? `Closed ${names[result.pane.view]}.`
            : "That is the only pane."
      }
      if (result.pane?.op === "only") {
        setLayout(onlyPane(layout, focused.id))
        said = panes.length > 1 ? "Closed the other panes." : "Already the only pane."
      }
      if (result.ticket) {
        setSelected(null)
        setSplitTask(result.ticket)
      }
      if (result.confirm) {
        setConfirm(result.confirm)
        reviewedState.current = w
      }
      if (result.clear) setLog([])
      else say(said)
    } catch (error) {
      print(echo, {
        kind: "error",
        text: error instanceof Error ? error.message : "Command failed.",
      })
    }
  }
  function formText(event: FormEvent<HTMLFormElement>, key: string) {
    return String(new FormData(event.currentTarget).get(key) ?? "").trim()
  }
  function exportBackup() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(w, null, 2)], { type: "application/json" })
    )
    const a = document.createElement("a")
    a.href = url
    a.download = `iterationscli-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  async function importBackup(file: File) {
    try {
      const saved: unknown = JSON.parse(await file.text())
      if (!isWorkspace(saved))
        throw new Error("That file is not an IterationsCLI workspace export.")
      if (
        !window.confirm(
          "Replace this workspace with the backup? Export the current workspace first if you may want it back."
        )
      )
        return
      commit(normalizeWorkspace(saved))
      setNotice("Backup restored.")
    } catch (error) {
      setNotice(
        error instanceof SyntaxError
          ? "That file is not valid JSON."
          : error instanceof Error
            ? error.message
            : "Could not read that file."
      )
    }
  }
  async function chooseFont(next: SavedFont | null) {
    setFontBusy(true)
    setFontMessage("")
    try {
      const remembered = await saveFont(next)
      setFont(next)
      setFontInput("")
      setFontMessage(
        !next
          ? "Back to JetBrains Mono."
          : remembered
            ? `Now using ${next.family} across the site.`
            : `Using ${next.family}, but the file is too large to remember in this browser. Try a .woff2 file.`
      )
    } catch (error) {
      // Put the previous font back; the failed one may have been half-applied.
      void applyFont(font).catch(() => {})
      setFontMessage(
        error instanceof Error
          ? error.message
          : "That font could not be loaded."
      )
    } finally {
      setFontBusy(false)
    }
  }
  function uploadFont(file: File) {
    if (!isFontFile(file.name))
      return setFontMessage("Choose a .woff2, .woff, .ttf or .otf file.")
    if (file.size > MAX_FONT_BYTES)
      return setFontMessage(
        "That font is larger than 1.5 MB. A .woff2 version is usually much smaller."
      )
    const reader = new FileReader()
    reader.onerror = () => setFontMessage("That file could not be read.")
    reader.onload = () =>
      void chooseFont({
        family: familyFromFile(file.name),
        source: "file",
        data: String(reader.result),
      })
    reader.readAsDataURL(file)
  }

  const chip = (label: Label, suffix = "") => (
    <span key={label.id} className={styles.label} style={labelStyle(label)}>
      {label.name}
      {suffix}
    </span>
  )

  function sidebar(inPopup = false) {
    return (
      <aside
        className={`${styles.sidebar} ${inPopup ? styles.popupSidebar : ""}`}
      >
        {!inPopup && (
          <Link href="/" className={styles.brand}>
            <span>i/</span> iterations
            <span className={styles.brandSuffix}>cli</span>
          </Link>
        )}
        <div className={styles.workspaceName}>
          <span className={styles.avatar}>P</span>
          <div>
            Personal workspace
            <small>
              {sync === "synced" || sync === "saving"
                ? "ACCOUNT SYNC"
                : "LOCAL ALPHA"}
            </small>
          </div>
        </div>
        <p className={styles.navLabel}>WORKSPACE</p>
        <nav aria-label={inPopup ? "Go to view" : "Workspace views"}>
          {VIEWS.map((tab) => (
            <button
              key={tab}
              className={view === tab ? styles.activeNav : ""}
              aria-current={view === tab ? "page" : undefined}
              title={
                inPopup ? undefined : "Click to open · drag onto a pane to split"
              }
              {...(inPopup ? {} : dragProps(tab))}
              onClick={() => {
                open(tab)
                if (inPopup) setTerminalOpen(false)
              }}
            >
              <span aria-hidden="true">{icons[tab]}</span>
              {names[tab]}
              {tab === "inbox" && w.proposals.length > 0 && (
                <small>{w.proposals.length}</small>
              )}
            </button>
          ))}
        </nav>
        {!inPopup && (
          <div className={styles.sidebarBottom}>
            <span className={styles.onlineDot} /> Personal ·{" "}
            {sync === "synced" || sync === "saving"
              ? "account sync"
              : "browser storage"}
            <p>{VERSION}</p>
            <span>Built for the work in progress.</span>
          </div>
        )}
      </aside>
    )
  }

  function terminal(popup = false) {
    return (
      <ShellTerminal
        flavor={shell}
        title={windowTitle(shell, promptContext)}
        status={sync === "synced" || sync === "saving" ? "SYNCED" : "LOCAL"}
        prompt={prompt}
        entries={log}
        value={command}
        onChange={setCommand}
        onSubmit={(line) => submitCommand(undefined, line)}
        completion={completion}
        registry={WorkspaceCommands}
        history={commands}
        confirming={!!confirm}
        onClear={() => setLog([])}
        onCancel={() => {
          print({
            kind: "command",
            prompt: confirm ? [{ text: confirmPrompt(shell) }] : prompt,
            text: `${command}^C`,
          })
          setCommand("")
          setConfirm(undefined)
        }}
        onExit={() => submitCommand(undefined, "exit")}
        inputRef={popup ? popupPrompt : mainPrompt}
        inputId={popup ? "workspace-popup-command" : "alpha-command"}
        // A terminal window already has a title bar of its own.
        chrome={!popup}
        autoFocus={!popup}
      />
    )
  }

  function ticket(task: Task, close: () => void, pane = false) {
    return (
      <div className={`${styles.ticketPanel} ${pane ? styles.ticketPane : ""}`}>
        <div className={styles.ticketHead}>
          <div>
            <p className={styles.eyebrow}>TICKET</p>
            <code title={task.id}>{task.id.slice(0, 8)}</code>
          </div>
          <button
            className={styles.iconButton}
            aria-label="Close ticket"
            title="Close"
            onClick={close}
          >
            ×
          </button>
        </div>
        <label className={styles.field}>
          Title
          <input
            value={task.title}
            onChange={(e) =>
              change((w) => updateTask(w, task.id, { title: e.target.value }))
            }
          />
        </label>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            Column
            <select
              value={task.column}
              onChange={(e) =>
                change((w) =>
                  updateTask(w, task.id, { column: e.target.value })
                )
              }
            >
              {w.columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Submission
            <select
              value={task.submission}
              onChange={(e) =>
                change((w) =>
                  updateTask(w, task.id, {
                    submission: e.target.value as Task["submission"],
                  })
                )
              }
            >
              <option value="none">Not applicable</option>
              <option value="pending">Not submitted</option>
              <option value="submitted">Submitted</option>
            </select>
          </label>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={task.done}
            onChange={(e) =>
              change((w) => updateTask(w, task.id, { done: e.target.checked }))
            }
          />
          Completed
        </label>
        <h2>Labels</h2>
        {w.labels.length ? (
          <div className={styles.badges}>
            {w.labels.map((l) => (
              <label
                key={l.id}
                className={`${styles.label} ${styles.labelToggle}`}
                style={labelStyle(l)}
              >
                <input
                  type="checkbox"
                  checked={task.labels.includes(l.id)}
                  onChange={(e) =>
                    change((w) =>
                      updateTask(w, task.id, {
                        labels: e.target.checked
                          ? [...task.labels, l.id]
                          : task.labels.filter((id) => id !== l.id),
                      })
                    )
                  }
                />
                {l.name}
              </label>
            ))}
          </div>
        ) : (
          <p className={styles.hint}>
            Create labels in Customize or with label new.
          </p>
        )}
        <h2>
          Linked whiteboard items{" "}
          <small>{ticketCanvasItems(w, task.id).length}</small>
        </h2>
        <div className={styles.canvasLinks}>
          {ticketCanvasItems(w, task.id).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSelected(null)
                open("canvas")
                setSplitTask(task.id)
                setCanvasFocus({ id: item.id, request: Date.now() })
              }}
            >
              <span>{item.kind}</span>
              <strong>{item.title}</strong>
              <span>Locate ↗</span>
            </button>
          ))}
          {!ticketCanvasItems(w, task.id).length && (
            <p className={styles.hint}>
              Link a canvas item to this ticket to see it here automatically.
            </p>
          )}
        </div>
        <h2>
          Comments <small>{task.comments.length}</small>
        </h2>
        <p className={styles.hint}>Discussion and feedback on this ticket.</p>
        {task.comments.map((c, i) => (
          <p className={styles.comment} key={i}>
            <span className={styles.commentLabel}>◌ Comment {i + 1}</span>
            {c}
          </p>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const text = formText(e, "comment")
            if (text) {
              change((w) =>
                updateTask(w, task.id, {
                  comments: [...task.comments, text],
                })
              )
              e.currentTarget.reset()
            }
          }}
        >
          <textarea
            name="comment"
            required
            aria-label="Comment"
            placeholder="Add context or a note…"
          />
          <button>Add comment</button>
        </form>
        <div className={styles.ticketFoot}>
          <span>Created {new Date(task.created).toLocaleDateString()}</span>
          <button
            className={styles.danger}
            onClick={() => {
              close()
              change(
                (w) => deleteTask(w, task.id),
                "Task deleted. Restore its checkpoint in History to undo."
              )
            }}
          >
            Delete task
          </button>
        </div>
      </div>
    )
  }

  function board() {
    const visible = w.tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(query.toLowerCase()) &&
        (!labelFilter || t.labels.includes(labelFilter)) &&
        (!needsSubmission || (t.done && t.submission === "pending"))
    )
    const cursorTask = visible.find((t) => t.id === boardCursor)
    return (
      <section
        className={styles.view}
        tabIndex={-1}
        data-keys
        // The arrow keys walk from ticket to ticket instead of scrolling:
        // Enter opens one, Space completes it, Shift+←/→ moves it a column.
        onKeyDown={(e) => {
          if (
            e.ctrlKey ||
            e.metaKey ||
            e.altKey ||
            (e.target as HTMLElement).closest(
              "input,textarea,select,[contenteditable=true],[role=menu]"
            )
          )
            return
          const step = {
            ArrowLeft: "left",
            ArrowRight: "right",
            ArrowUp: "up",
            ArrowDown: "down",
          }[e.key] as "left" | "right" | "up" | "down" | undefined
          if (step) {
            e.preventDefault()
            if (e.shiftKey && cursorTask && (step === "left" || step === "right")) {
              const to =
                w.columns[
                  w.columns.indexOf(cursorTask.column) +
                    (step === "left" ? -1 : 1)
                ]
              if (to) change((w) => updateTask(w, cursorTask.id, { column: to }))
              return
            }
            const next = boardNeighbour(w.columns, visible, cursorTask?.id, step)
            if (!next) return
            setBoardCursor(next)
            document
              .querySelector(`[data-ticket="${next}"]`)
              ?.scrollIntoView({ block: "nearest", inline: "nearest" })
          } else if (e.key === "Enter" && cursorTask) {
            if ((e.target as HTMLElement).closest("button,a")) return
            e.preventDefault()
            setSelected(cursorTask.id)
          } else if (e.key === " " && cursorTask) {
            if ((e.target as HTMLElement).closest("button,a")) return
            e.preventDefault()
            change((w) =>
              updateTask(w, cursorTask.id, { done: !cursorTask.done })
            )
          }
        }}
      >
        <div className={styles.viewTitle}>
          <div>
            <p className={styles.eyebrow}>A PLACE FOR EVERY NEXT STEP</p>
            <h1>
              Task board <small>{w.tasks.length}</small>
            </h1>
          </div>
          <button
            onClick={() => {
              open("terminal")
              setCommand('task new ""')
            }}
          >
            Use terminal ↗
          </button>
        </div>
        <div className={styles.toolbar}>
          <input
            aria-label="Search tasks"
            placeholder="Search tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Filter by label"
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value)}
          >
            <option value="">All labels</option>
            {w.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            aria-pressed={needsSubmission}
            onClick={() => setNeedsSubmission(!needsSubmission)}
          >
            Needs submission ({pending.length})
          </button>
        </div>
        <form
          className={styles.inlineForm}
          onSubmit={(e) => {
            e.preventDefault()
            const title = formText(e, "title")
            if (title) {
              change((w) => addTask(w, title), "Task created.")
              e.currentTarget.reset()
            }
          }}
        >
          <input
            name="title"
            required
            aria-label="New task title"
            placeholder="What needs doing?"
          />
          <button className={styles.primary}>+ Add task</button>
        </form>
        <div className={styles.board}>
          {w.columns.map((column) => {
            const fallback = w.columns.find((c) => c !== column)
            return (
              <div
                className={styles.column}
                key={column}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData("text/plain")
                  if (w.tasks.some((t) => t.id === id))
                    change((w) => updateTask(w, id, { column }))
                }}
              >
                <div className={styles.columnHead}>
                  <span className={styles.columnDot} />
                  {renaming === column ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (
                          change((w) =>
                            renameColumn(w, column, formText(e, "name"))
                          )
                        )
                          setRenaming(null)
                      }}
                    >
                      <input
                        name="name"
                        required
                        autoFocus
                        defaultValue={column}
                        aria-label={`Rename ${column}`}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={() => setRenaming(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setRenaming(null)
                        }}
                      />
                    </form>
                  ) : (
                    <h2 onDoubleClick={() => setRenaming(column)}>{column}</h2>
                  )}
                  <small>
                    {visible.filter((t) => t.column === column).length}
                  </small>
                  <Menu
                    label={`${column} column options`}
                    className={styles.moreButton}
                    items={[
                      {
                        label: "Rename",
                        onSelect: () => setRenaming(column),
                      },
                      {
                        label: "Delete column",
                        danger: true,
                        disabled: !fallback,
                        title: fallback
                          ? `Tasks move to ${fallback}. A restore checkpoint is saved.`
                          : "Keep at least one column.",
                        onSelect: () =>
                          change(
                            (w) => deleteColumn(w, column),
                            `Column deleted. Tasks moved to ${fallback}. Undo in History.`
                          ),
                      },
                    ]}
                  >
                    ⋯
                  </Menu>
                </div>
                {visible
                  .filter((t) => t.column === column)
                  .map((t) => (
                    <article
                      key={t.id}
                      className={styles.ticket}
                      data-ticket={t.id}
                      data-cursor={t.id === boardCursor ? "" : undefined}
                      onPointerDown={() => setBoardCursor(t.id)}
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/plain", t.id)
                      }
                    >
                      <div className={styles.ticketTop}>
                        <span>{t.id.slice(0, 8)}</span>
                        <input
                          type="checkbox"
                          checked={t.done}
                          aria-label={`Complete ${t.title}`}
                          onChange={(e) =>
                            change((w) =>
                              updateTask(w, t.id, { done: e.target.checked })
                            )
                          }
                        />
                      </div>
                      <button
                        className={`${styles.ticketTitle} ${t.done ? styles.done : ""}`}
                        onClick={() => setSelected(t.id)}
                      >
                        {t.title}
                      </button>
                      {(t.labels.length > 0 || t.submission !== "none") && (
                        <div className={styles.badges}>
                          {t.labels.map((id) => {
                            const label = w.labels.find((l) => l.id === id)
                            return label ? chip(label) : null
                          })}
                          {t.submission !== "none" && (
                            <span className={styles.badge}>
                              {t.submission === "pending"
                                ? "Not submitted"
                                : "Submitted"}
                            </span>
                          )}
                        </div>
                      )}
                      <div className={styles.ticketFoot}>
                        <span>
                          {t.comments.length}{" "}
                          {t.comments.length === 1 ? "comment" : "comments"}
                        </span>
                        <button onClick={() => setSelected(t.id)}>
                          Details ↗
                        </button>
                      </div>
                    </article>
                  ))}
                {!visible.some((t) => t.column === column) && (
                  <div className={styles.emptyColumn}>
                    Room for your next step.
                  </div>
                )}
              </div>
            )
          })}
          <form
            className={styles.newColumn}
            onSubmit={(e) => {
              e.preventDefault()
              const form = e.currentTarget
              if (change((w) => addColumn(w, formText(e, "column"))))
                form.reset()
            }}
          >
            <input
              name="column"
              required
              aria-label="New column name"
              placeholder="Column name"
            />
            <button>+ Add column</button>
          </form>
        </div>
        <p className={styles.hint}>
          Drag tickets between columns, or move them in Details. Use ⋯ on a
          column to rename or delete it. Completion is separate from column and
          submission status.
        </p>
      </section>
    )
  }
  function canvas() {
    return (
      <Whiteboard
        focusItem={canvasFocus}
        groups={w.groups ?? []}
        onConnect={(from, to) =>
          change((w) => linkItems(w, from, to), "Connected. Select the arrow to change its ends.")
        }
        onSelectionAction={(selected, action) =>
          change(
            (w) => applySelection(w, selected, action),
            `Canvas ${action.type} saved. Restore in History if needed.`
          )
        }
        camera={boardCamera}
        setCamera={setBoardCamera}
        onSize={(size) => {
          boardSize.current = size
        }}
        objects={w.objects ?? []}
        tasks={w.tasks}
        columns={w.columns}
        onObjectChange={(id, patch) =>
          change((w) => ({
            ...w,
            objects: w.objects.map((o) =>
              o.id === id ? { ...o, ...patch, id: o.id } : o
            ),
          }))
        }
        onObjectDelete={(id) =>
          change(
            (w) => ({
              ...checkpoint(w, "Before deleting whiteboard object"),
              objects: w.objects
                .filter((o) => o.id !== id)
                .map((o) => {
                  if (
                    o.kind !== "arrow" ||
                    (o.from?.objectId !== id && o.to?.objectId !== id)
                  )
                    return o
                  return {
                    ...resolveArrow(o, w.objects),
                    from: o.from?.objectId === id ? undefined : o.from,
                    to: o.to?.objectId === id ? undefined : o.to,
                  }
                }),
            }),
            "Object deleted. Undo in History."
          )
        }
        onObjectAdd={(kind) =>
          change((w) => addWhiteboardObject(w, kind, "", boardCenter()))
        }
        onLinkTicket={(id) =>
          change(
            (w) => linkObjectToTask(w, id),
            "Ticket link added. Choose its ticket on the new node."
          )
        }
        onOpenTask={(id) => setSplitTask(id)}
        onBoardTask={(title, column) =>
          change((w) => {
            const next = addTask(w, title)
            return updateTask(next, next.tasks.at(-1)!.id, { column })
          })
        }
        onTaskChange={(id, patch) => change((w) => updateTask(w, id, patch))}
        strokes={w.strokes}
        notes={w.notes}
        color={penColor}
        palette={palette}
        penWidth={w.penWidth ?? 3}
        onPen={({ color, width }) =>
          change((w) => ({
            ...w,
            penColor: color ?? w.penColor,
            penWidth: width ?? w.penWidth,
          }))
        }
        onPaletteAdd={(color) => change((w) => addPaletteColor(w, color))}
        onPaletteRemove={(color) => change((w) => removePaletteColor(w, color))}
        onStroke={(stroke) =>
          change((w) => ({ ...w, strokes: [...w.strokes, stroke] }))
        }
        onUndo={() =>
          change((w) => ({ ...w, strokes: w.strokes.slice(0, -1) }))
        }
        onNotes={(notes) => change((w) => ({ ...w, notes }))}
        onTask={(text) =>
          change((w) => {
            const next = addTask(w, text)
            return updateTask(next, next.tasks.at(-1)!.id, {
              comments: ["Created from Canvas notes: " + text],
            })
          }, "Task created from your selection.")
        }
      />
    )
  }
  function stats() {
    const percent = w.tasks.length
      ? Math.round((completed / w.tasks.length) * 100)
      : 0
    const progress = (
      name: string,
      done: number,
      total: number,
      key: string
    ) => (
      <div className={styles.progressRow} key={key}>
        <span>{name}</span>
        <progress max={total || 1} value={done} />
        <span>
          {done}/{total}
        </span>
      </div>
    )
    return (
      <section className={styles.view}>
        <p className={styles.eyebrow}>SMALL STEPS. VISIBLE PROGRESS.</p>
        <h1>Your statistics</h1>
        <div className={styles.metrics}>
          {[
            [w.tasks.length, "Total tasks"],
            [completed, "Completed"],
            [`${percent}%`, "Completion"],
            [pending.length, "Needs submission"],
          ].map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        {!w.tasks.length && (
          <div className={styles.empty}>
            Nothing to measure yet.
            <span>
              Create a task on the board or with task new, and your progress
              shows up here.
            </span>
          </div>
        )}
        <TrendChart tasks={w.tasks} />
        <div className={styles.panelGrid}>
          <div className={styles.panel}>
            <h2>By column</h2>
            {w.columns.map((c) =>
              progress(
                c,
                w.tasks.filter((t) => t.column === c && t.done).length,
                w.tasks.filter((t) => t.column === c).length,
                c
              )
            )}
          </div>
          <div className={styles.panel}>
            <h2>By label</h2>
            {w.labels.map((l) => (
              <div className={styles.progressRow} key={l.id}>
                {chip(l)}
                <progress
                  max={
                    w.tasks.filter((t) => t.labels.includes(l.id)).length || 1
                  }
                  value={
                    w.tasks.filter((t) => t.labels.includes(l.id) && t.done)
                      .length
                  }
                />
                <span>
                  {
                    w.tasks.filter((t) => t.labels.includes(l.id) && t.done)
                      .length
                  }
                  /{w.tasks.filter((t) => t.labels.includes(l.id)).length}
                </span>
              </div>
            ))}
            {!w.labels.length && (
              <p className={styles.hint}>
                No labels yet. Create them in Customize.
              </p>
            )}
          </div>
        </div>
      </section>
    )
  }
  function inbox() {
    return (
      <section className={styles.view}>
        <p className={styles.eyebrow}>YOU DECIDE WHAT COMES IN</p>
        <h1>
          Incoming changes <small>{w.proposals.length}</small>
        </h1>
        <p className={styles.muted}>
          Review proposed changes before they reach your board. This alpha
          accepts manual JSON imports; external connectors are planned.
        </p>
        {w.proposals.map((p) => {
          const old = w.tasks.find((t) => t.id === p.taskId)
          return (
            <div className={styles.panel} key={p.id}>
              <div className={styles.ticketTop}>
                <span>{p.source}</span>
                <code>{p.id}</code>
              </div>
              <h2>{p.title}</h2>
              <p className={styles.muted}>
                {old
                  ? `Update: “${old.title}” → “${p.title}”${p.done !== undefined ? ` · Completed: ${old.done ? "yes" : "no"} → ${p.done ? "yes" : "no"}` : ""}`
                  : "Create a new task in the first column"}
              </p>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  onClick={() => {
                    open("terminal")
                    submitCommand(undefined, `merge "${p.id}"`)
                  }}
                >
                  Review merge →
                </button>
                <button
                  onClick={() =>
                    change(
                      (w) => ({
                        ...w,
                        proposals: w.proposals.filter((x) => x.id !== p.id),
                      }),
                      "Proposal dismissed."
                    )
                  }
                >
                  Dismiss
                </button>
              </div>
            </div>
          )
        })}
        {!w.proposals.length && (
          <div className={styles.empty}>
            All caught up.
            <span>Imported proposals will appear here for review.</span>
          </div>
        )}
        <form
          className={styles.panel}
          onSubmit={(e) => {
            e.preventDefault()
            if (
              change(
                (w) => ({
                  ...w,
                  proposals: [
                    ...w.proposals,
                    ...parseProposals(pendingJson, w),
                  ],
                }),
                "Proposals imported. Review before merging."
              )
            )
              setPendingJson("")
          }}
        >
          <h2>Import proposals</h2>
          <p className={styles.hint}>
            Required: id, title, source. Optional for updates: taskId (full ID),
            done (boolean).
          </p>
          <textarea
            aria-label="Proposal JSON"
            required
            value={pendingJson}
            onChange={(e) => setPendingJson(e.target.value)}
            placeholder={
              '[{"id":"example-1","title":"Review the design","source":"Manual import"}]'
            }
          />
          <div className={styles.actions}>
            <button className={styles.primary}>Import for review</button>
            <button
              type="button"
              onClick={() =>
                setPendingJson(
                  JSON.stringify(
                    [
                      {
                        id: `example-${uid().slice(0, 6)}`,
                        title: "Review the design",
                        source: "Manual import",
                      },
                    ],
                    null,
                    2
                  )
                )
              }
            >
              Insert example
            </button>
          </div>
        </form>
      </section>
    )
  }
  function history() {
    return (
      <section className={styles.view}>
        <p className={styles.eyebrow}>MOVE FORWARD. KEEP A WAY BACK.</p>
        <h1>
          Workspace history <small>{w.commits.length}</small>
        </h1>
        <p className={styles.muted}>
          Named checkpoints save tasks, columns, labels, whiteboard items,
          drawings, and notes. Restoring preserves the history and saves the
          current state first.
        </p>
        <form
          className={styles.inlineForm}
          onSubmit={(e) => {
            e.preventDefault()
            change(
              (w) => checkpoint(w, formText(e, "message")),
              "Checkpoint saved."
            )
            e.currentTarget.reset()
          }}
        >
          <input
            name="message"
            required
            placeholder="Describe this checkpoint"
            aria-label="Checkpoint description"
          />
          <button className={styles.primary}>Save checkpoint</button>
        </form>
        {w.commits.length > 0 && (
          <div className={styles.historyList}>
            {[...w.commits].reverse().map((c) => (
              <div className={styles.historyRow} key={c.id}>
                <code title={c.id}>{c.id.slice(0, 8)}</code>
                <div>
                  <strong>{c.message}</strong>
                  <span>
                    {new Date(c.date).toLocaleString()} ·{" "}
                    {c.snapshot.tasks.length} tasks ·{" "}
                    {(c.snapshot.objects ?? []).length} whiteboard items
                  </span>
                </div>
                <button
                  onClick={() => {
                    open("terminal")
                    submitCommand(undefined, `revert ${c.id}`)
                  }}
                >
                  Restore…
                </button>
              </div>
            ))}
          </div>
        )}
        {!w.commits.length && (
          <div className={styles.empty}>
            Your story starts here.
            <span>Save a checkpoint before a big change.</span>
          </div>
        )}
      </section>
    )
  }
  function settings() {
    return (
      <section className={styles.view}>
        <p className={styles.eyebrow}>MAKE YOURSELF AT HOME</p>
        <h1>Customize your space</h1>
        <div className={styles.panel}>
          <h2>Website theme</h2>
          <p className={styles.muted}>
            Original follows the website’s black-and-white theme. Optional
            palettes change the accent color.
          </p>
          <div className={styles.swatches}>
            {Object.entries(THEMES).map(([name, color]) => (
              <button
                key={name}
                aria-pressed={w.theme === name}
                onClick={() =>
                  change((w) => ({ ...w, theme: name, accent: color }))
                }
              >
                <span style={{ background: color }} />
                {name}
              </button>
            ))}
            <label
              className={styles.customAccent}
              data-active={w.theme === "custom"}
            >
              <input
                type="color"
                value={w.accent}
                onChange={(e) =>
                  change((w) => ({
                    ...w,
                    accent: e.target.value,
                    theme: "custom",
                  }))
                }
              />
              Custom accent
            </label>
          </div>
          <div className={styles.actions}>
            <button
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              Switch to {resolvedTheme === "dark" ? "light" : "dark"} mode
            </button>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={w.scanlines}
                onChange={(e) =>
                  change((w) => ({ ...w, scanlines: e.target.checked }))
                }
              />
              Subtle retro scanlines
            </label>
          </div>
        </div>
        <div className={styles.panel}>
          <h2>Typography</h2>
          <p className={styles.muted}>
            Change the font used across the site. It is remembered in this
            browser.
          </p>
          <div className={styles.fontCurrent}>
            <div>
              <strong>{font?.family ?? "JetBrains Mono"}</strong>
              <small>
                {font
                  ? font.source === "google"
                    ? "Google Fonts"
                    : "Uploaded file"
                  : "Default"}
              </small>
            </div>
            <p aria-hidden="true">
              The quick brown fox jumps over the lazy dog. 0123456789 {"{ }"}{" "}
              =&gt; !=
            </p>
            {font && (
              <button disabled={fontBusy} onClick={() => void chooseFont(null)}>
                Reset to default
              </button>
            )}
          </div>
          <form
            className={styles.inlineForm}
            onSubmit={(e) => {
              e.preventDefault()
              try {
                void chooseFont({
                  ...parseGoogleFont(fontInput),
                  source: "google",
                })
              } catch (error) {
                setFontMessage(
                  error instanceof Error ? error.message : "Invalid font."
                )
              }
            }}
          >
            <input
              required
              value={fontInput}
              onChange={(e) => setFontInput(e.target.value)}
              aria-label="Google Fonts name or link"
              placeholder='Google Fonts name or link, e.g. "Fira Code"'
            />
            <button disabled={fontBusy}>
              {fontBusy ? "Loading…" : "Use font"}
            </button>
            <label className={styles.fileButton}>
              Upload font file…
              <input
                type="file"
                accept=".woff2,.woff,.ttf,.otf,font/*"
                disabled={fontBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadFont(file)
                  e.target.value = ""
                }}
              />
            </label>
          </form>
          {fontMessage && (
            <p className={styles.formMessage} role="status">
              {fontMessage}
            </p>
          )}
          <p className={styles.hint}>
            Google fonts load from fonts.googleapis.com. Uploads accept .woff2,
            .woff, .ttf and .otf up to 1.5 MB and stay on this device. Animation
            respects reduced-motion preferences.
          </p>
        </div>
        <div className={styles.panel}>
          <h2>
            Labels <small>{w.labels.length}</small>
          </h2>
          <p className={styles.muted}>
            Global labels are available workspace-wide; local labels belong to
            this board. This alpha has one board.
          </p>
          <form
            className={styles.inlineForm}
            onSubmit={(e) => {
              e.preventDefault()
              const data = new FormData(e.currentTarget)
              const name = String(data.get("name")).trim()
              if (!name || w.labels.some((l) => l.name === name)) {
                setNotice("Choose a unique label name.")
                return
              }
              change((w) => ({
                ...w,
                labels: [
                  ...w.labels,
                  {
                    id: uid(),
                    name,
                    scope: data.get("scope") as "global" | "local",
                    color: String(data.get("color")),
                  },
                ],
              }))
              e.currentTarget.reset()
            }}
          >
            <input
              name="color"
              type="color"
              defaultValue={isHexColor(w.accent) ? w.accent : "#60a5fa"}
              aria-label="Label color"
              title="Label color"
            />
            <input
              name="name"
              required
              placeholder="Label name"
              aria-label="Label name"
            />
            <select name="scope" aria-label="Label scope">
              <option value="global">Global</option>
              <option value="local">Local</option>
            </select>
            <button>Add label</button>
          </form>
          {w.labels.length > 0 && (
            <ul className={styles.labelList}>
              {w.labels.map((l) => (
                <li key={l.id}>
                  <input
                    type="color"
                    value={isHexColor(l.color) ? l.color : "#777777"}
                    aria-label={`Color of ${l.name}`}
                    title="Change color"
                    onChange={(e) =>
                      change((w) => setLabelColor(w, l.id, e.target.value))
                    }
                  />
                  {chip(l)}
                  <small>{l.scope}</small>
                  <small>
                    {w.tasks.filter((t) => t.labels.includes(l.id)).length}{" "}
                    tasks
                  </small>
                  <button
                    className={styles.iconButton}
                    aria-label={`Delete label ${l.name}`}
                    title="Delete label"
                    onClick={() =>
                      change(
                        (w) =>
                          deleteLabel(
                            checkpoint(w, `Before deleting label: ${l.name}`),
                            l.id
                          ),
                        "Label deleted. Undo in History."
                      )
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.panel}>
          <h2>Your data</h2>
          <p className={styles.muted}>
            {sync === "synced" || sync === "saving" || sync === "error"
              ? "Saved in this browser and synced to your account. Sign in on another device to pick up where you left off."
              : sync === "signed-out"
                ? "Stored in this browser on this device. Sign in from the home page to sync this workspace to your account."
                : "Stored in this browser on this device. No account or cloud sync is required. Export backups before clearing browser data."}
          </p>
          <div className={styles.actions}>
            <button onClick={exportBackup}>Export workspace JSON ↓</button>
            <label className={styles.fileButton}>
              Restore from backup…
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void importBackup(file)
                  e.target.value = ""
                }}
              />
            </label>
          </div>
          <p className={styles.hint}>
            Alpha {VERSION} · Under active rework and testing.
          </p>
        </div>
        <details className={styles.panel}>
          <summary>Command reference</summary>
          <pre className={styles.help}>{HELP}</pre>
        </details>
      </section>
    )
  }
  function terminalWindow() {
    return (
      <>
        <div
          className={`${styles.popupTitlebar} ${terminalMode === "floating" ? styles.dragTitlebar : ""}`}
          onPointerDown={(e) => {
            if (
              terminalMode !== "floating" ||
              e.button !== 0 ||
              (e.target as HTMLElement).closest("button,select")
            )
              return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            terminalDrag.current = {
              x: e.clientX,
              y: e.clientY,
              left: terminalPosition.x,
              top: terminalPosition.y,
            }
          }}
          onPointerMove={(e) => {
            const drag = terminalDrag.current,
              rect = floatingTerminal.current?.getBoundingClientRect()
            if (!drag || !rect) return
            setTerminalPosition({
              x: Math.max(
                0,
                Math.min(
                  window.innerWidth - rect.width,
                  drag.left + e.clientX - drag.x
                )
              ),
              y: Math.max(
                0,
                Math.min(window.innerHeight - 48, drag.top + e.clientY - drag.y)
              ),
            })
          }}
          onPointerUp={() => {
            terminalDrag.current = null
          }}
          onPointerCancel={() => {
            terminalDrag.current = null
          }}
        >
          <h2 id="workspace-terminal-title">
            &gt;_ {SHELL_TITLES[shell]} · workspace terminal
          </h2>
          <div className={styles.terminalWindowControls}>
            <button
              title="Cycle terminal mode (M outside text fields)"
              onClick={cycleTerminalMode}
            >
              M
            </button>
            <select
              aria-label="Terminal mode"
              value={terminalMode}
              onChange={(e) =>
                setTerminalMode(e.target.value as typeof terminalMode)
              }
            >
              <option value="modal">Active modal</option>
              <option value="floating">Floating window</option>
              <option value="split">Split pane</option>
            </select>
            <button
              aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
              onClick={() => setSidebarHidden((hidden) => !hidden)}
            >
              ☰
            </button>
            <button
              className={styles.iconButton}
              aria-label="Close workspace terminal"
              onClick={() => setTerminalOpen(false)}
            >
              ×
            </button>
          </div>
        </div>
        <div className={styles.popupBody}>
          {terminalMode === "modal" && !sidebarHidden && sidebar(true)}
          {terminal(true)}
        </div>
        <div className={styles.popupHint}>
          Tab complete · ↑↓ history · Ctrl+R search · Esc or Ctrl+Y close · M
          mode (outside the prompt)
        </div>
      </>
    )
  }
  const render = (tab: View) =>
    ({ terminal, board, canvas, stats, inbox, history, settings })[tab]()
  const unopened = VIEWS.filter((v) => !tabs.includes(v))
  // A ticket or a docked terminal sits beside the panes, behind a divider.
  const docked = ready && terminalOpen && terminalMode === "split"
  const beside = ready && (!!paneTask || docked)
  return (
    <main
      className={`${styles.shell} ${w.scanlines ? styles.scanlines : ""}`}
      style={
        {
          "--alpha-accent":
            w.theme === "original" ? "var(--primary)" : w.accent,
        } as CSSProperties
      }
    >
      {!sidebarHidden && sidebar()}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
            aria-expanded={!sidebarHidden}
            onClick={() => setSidebarHidden((hidden) => !hidden)}
          >
            ☰
          </button>
          <span>
            Workspace <span className={styles.muted}>/</span>{" "}
            <b>{names[view]}</b>
          </span>
          <div>
            <span className={styles.alphaBadge}>ALPHA 01</span>
            <button
              disabled={!ready}
              onClick={() => setTerminalOpen(true)}
              aria-keyshortcuts="Control+y"
            >
              &gt;_ Terminal <small>Ctrl+Y</small>
            </button>
            <button
              disabled={!ready}
              onClick={() => splitWith("row", null)}
              aria-keyshortcuts="Control+\"
              title="Split side by side and choose what to open (Ctrl+\ or V)"
            >
              ◫ Split <small>Ctrl+\</small>
            </button>
            <button
              disabled={!ready}
              onClick={() => splitWith("column", null)}
              aria-label="Split top and bottom"
              title="Split top and bottom and choose what to open (Ctrl+Shift+\ or H)"
            >
              ⬓
            </button>
          </div>
        </header>
        <div className={styles.tabbar} role="tablist" aria-label="Open views">
          {tabs.map((v) => (
            <div
              key={v}
              className={`${styles.tab} ${view === v ? styles.activeTab : ""}`}
              title="Drag onto a pane to split"
              {...dragProps(v)}
            >
              <button
                role="tab"
                aria-selected={view === v}
                onClick={() => open(v)}
              >
                <span aria-hidden="true">{icons[v]}</span> {names[v]}
              </button>
              {tabs.length > 1 && (
                <button
                  className={styles.tabClose}
                  aria-label={`Close ${names[v]} tab`}
                  title="Close tab"
                  onClick={() => closeTab(v)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {unopened.length > 0 && (
            <Menu
              label="Open another view"
              className={styles.tabAdd}
              align="start"
              items={unopened.map((v) => ({
                label: (
                  <>
                    <span aria-hidden="true">{icons[v]}</span> {names[v]}
                  </>
                ),
                onSelect: () => open(v),
              }))}
            >
              ＋
            </Menu>
          )}
        </div>
        {storageError && (
          <div className={styles.warning} role="alert">
            {storageError}{" "}
            <button onClick={exportBackup}>Export current workspace</button>
          </div>
        )}
        {notice && (
          <div className={styles.notice} role="status">
            {notice}
            <button
              className={styles.iconButton}
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        <div className={`${styles.panes} ${beside ? styles.split : ""}`}>
          <div
            className={styles.paneArea}
            style={beside ? { flexGrow: sideRatio } : undefined}
          >
            {ready ? (
              <PaneTree
                layout={layout}
                focus={focused.id}
                multi={panes.length > 1}
                dragging={dragView !== null}
                title={(pane) =>
                  pane.view ? (
                    <>
                      <span aria-hidden="true">{icons[pane.view]}</span>{" "}
                      {names[pane.view]}
                    </>
                  ) : (
                    "New pane"
                  )
                }
                renderLeaf={(pane) => (
                  <div
                    className={`${styles.pane} ${pane.view === "canvas" ? styles.canvasPane : ""}`}
                  >
                    {pane.view ? (
                      render(pane.view)
                    ) : (
                      <PaneChooser
                        options={VIEWS.filter(
                          (v) => !findView(layout, v)
                        ).map((v) => ({
                          view: v,
                          label: (
                            <>
                              <span aria-hidden="true">{icons[v]}</span>{" "}
                              {names[v]}
                            </>
                          ),
                        }))}
                        autoFocus={pane.id === focused.id}
                        onPick={(v) => {
                          setLayout(setPaneView(layout, pane.id, v))
                          addTab(v)
                          focusPane(pane.id)
                        }}
                        onClose={() => closePaneById(pane.id)}
                      />
                    )}
                  </div>
                )}
                onFocus={setFocus}
                onResize={(id, ratio) =>
                  setLayout((current) => resizeSplit(current, id, ratio))
                }
                onDropView={dropView}
                onSplit={(id, direction) =>
                  splitWith(direction, null, { target: id })
                }
                onClose={closePaneById}
                onDragView={setDragView}
              />
            ) : (
              <div className={`${styles.pane} ${styles.empty} ${styles.loading}`}>
                {storageError
                  ? "Workspace recovery needed."
                  : "Opening workspace…"}
              </div>
            )}
          </div>
          {beside && (
            <Divider
              direction="row"
              ratio={sideRatio}
              onChange={(ratio) =>
                setSideRatio(Math.min(0.85, Math.max(0.2, ratio)))
              }
              label="Resize the side pane"
            />
          )}
          {beside && (
            <div
              className={styles.sideArea}
              style={{ flexGrow: 1 - sideRatio }}
            >
              {paneTask && (
                <div className={styles.pane} aria-label="Ticket">
                  {ticket(paneTask, () => setSplitTask(null), true)}
                </div>
              )}
              {docked && (
                <div
                  className={`${styles.pane} ${styles.dockedTerminal}`}
                  role="region"
                  aria-label="Terminal split pane"
                >
                  {terminalWindow()}
                </div>
              )}
            </div>
          )}
        </div>
        <footer className={styles.statusbar}>
          <span>
            <span
              className={`${styles.onlineDot} ${storageError || sync === "error" ? styles.offlineDot : ""}`}
            />
            {storageError
              ? "Storage needs attention"
              : ready
                ? syncText[sync]
                : "Loading"}
          </span>
          <span>
            {completed}/{w.tasks.length} complete{" "}
            <span className={styles.muted}>/</span> {VERSION}
          </span>
        </footer>
      </div>
      <dialog
        ref={terminalDialog}
        className={styles.terminalPopup}
        aria-labelledby="workspace-terminal-title"
        onCancel={() => setTerminalOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setTerminalOpen(false)
        }}
      >
        {terminalOpen && terminalMode === "modal" && terminalWindow()}
      </dialog>
      {ready && terminalOpen && terminalMode === "floating" && (
        <div
          ref={floatingTerminal}
          className={styles.floatingTerminal}
          role="region"
          aria-label="Floating workspace terminal"
          style={{ left: terminalPosition.x, top: terminalPosition.y }}
        >
          {terminalWindow()}
        </div>
      )}
      <dialog
        ref={dialog}
        className={styles.dialog}
        onCancel={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(null)
        }}
      >
        {task && ticket(task, () => setSelected(null))}
      </dialog>
    </main>
  )
}
