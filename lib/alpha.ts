export const VERSION = "0.1.0-alpha.1"
export type Task = {
  id: string
  title: string
  column: string
  done: boolean
  submission: "none" | "pending" | "submitted"
  labels: string[]
  created: string
  completed?: string
  comments: string[]
}
export type Label = {
  id: string
  name: string
  color: string
  scope: "global" | "local"
}
export type Stroke = {
  id: string
  points: [number, number][]
  color: string
  /** Pen thickness in canvas units. Older strokes have none and render at 3. */
  width?: number
}
export const PEN_WIDTHS = [2, 3, 5, 8, 14]
export const DEFAULT_PALETTE = ["#e5e5e5", "#f87171", "#fbbf24", "#4ade80", "#60a5fa", "#c084fc"]
export const STICKY_COLORS = ["#e4b93d", "#f08a7b", "#7fc98b", "#6fb1e8", "#b99cf0", "#9aa0a6"]
export const TEXT_SIZES = [14, 18, 24, 36, 56]
export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
export type WhiteboardObject = {
  html?: string
  from?: Connection
  to?: Connection
  locked?: boolean
  id: string
  kind: WhiteboardKind
  /** Sticky tint or free-text color (hex). */
  color?: string
  /** Free-text size in px. */
  fontSize?: number
  /** Ticket a link node points at. */
  taskId?: string
  x: number
  y: number
  width: number
  height: number
  text: string
}
export type WhiteboardKind =
  | "sticky"
  | "kanban"
  | "arrow"
  | "document"
  | "text"
  | "link"
export const WHITEBOARD_KINDS: WhiteboardKind[] = [
  "sticky",
  "kanban",
  "arrow",
  "document",
  "text",
  "link",
]
export type Connection = { objectId: string; side: "top" | "right" | "bottom" | "left" }
export function connectionPoint(object: WhiteboardObject, side: Connection["side"]) {
  return { x: object.x + (side === "left" ? 0 : side === "right" ? object.width : object.width / 2), y: object.y + (side === "top" ? 0 : side === "bottom" ? object.height : object.height / 2) }
}
export function resolveArrow(item: WhiteboardObject, objects: WhiteboardObject[]): WhiteboardObject {
  if (item.kind !== "arrow") return item
  const source = objects.find(o => o.id === item.from?.objectId)
  const target = objects.find(o => o.id === item.to?.objectId)
  const start = source && item.from ? connectionPoint(source, item.from.side) : { x: item.x, y: item.y }
  const end = target && item.to ? connectionPoint(target, item.to.side) : { x: item.x + item.width, y: item.y + item.height }
  return { ...item, x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y }
}
export function connectObjects(w: Workspace, from: Connection, to: Connection): Workspace {
  const source = w.objects.find(o => o.id === from.objectId && o.kind !== "arrow")
  const target = w.objects.find(o => o.id === to.objectId && o.kind !== "arrow")
  if (!source || !target || source.id === target.id) throw new Error("Connect two different items.")
  const start = connectionPoint(source, from.side), end = connectionPoint(target, to.side)
  return { ...w, objects: [...w.objects, { id: uid(), kind: "arrow", text: "", x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y, from, to }] }
}
/** Side of `object` closest to a point; used when an arrow end is dropped on an item. */
export function nearestSide(object: WhiteboardObject, point: { x: number; y: number }): Connection["side"] {
  const sides = ["top", "right", "bottom", "left"] as const
  let best: Connection["side"] = "top", distance = Infinity
  for (const side of sides) {
    const p = connectionPoint(object, side)
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2
    if (d < distance) { distance = d; best = side }
  }
  return best
}
/** Topmost connectable item under a point (arrows never accept connections). */
export function objectAt(objects: WhiteboardObject[], point: { x: number; y: number }, exclude?: string, margin = 12): WhiteboardObject | undefined {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]
    if (o.kind === "arrow" || o.id === exclude) continue
    if (point.x >= o.x - margin && point.x <= o.x + o.width + margin && point.y >= o.y - margin && point.y <= o.y + o.height + margin) return o
  }
}
/** Sides that face each other, so a new arrow takes the short way between two items. */
export function facingSides(a: WhiteboardObject, b: WhiteboardObject): [Connection["side"], Connection["side"]] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2), dy = b.y + b.height / 2 - (a.y + a.height / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"]
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"]
}
/** Adds a ticket link node beside an item and connects the two with an arrow. */
export function linkObjectToTask(w: Workspace, objectId: string, taskId?: string): Workspace {
  const source = w.objects.find(o => o.id === objectId && o.kind !== "arrow")
  if (!source) throw new Error("Whiteboard item not found.")
  if (taskId !== undefined && !w.tasks.some(t => t.id === taskId)) throw new Error("Task not found.")
  const node: WhiteboardObject = { id: uid(), kind: "link", text: "", taskId, x: source.x + source.width + 90, y: source.y + source.height / 2 - 48, width: 240, height: 96 }
  const next = { ...w, objects: [...w.objects, node] }
  return connectObjects(next, { objectId: source.id, side: "right" }, { objectId: node.id, side: "left" })
}
export function renameColumn(w: Workspace, from: string, to: string): Workspace {
  const name = to.trim()
  if (!w.columns.includes(from)) throw new Error("Column not found.")
  if (!name) throw new Error("A column needs a name.")
  if (name === from) return w
  if (w.columns.includes(name)) throw new Error("A column with that name already exists.")
  return {
    ...w,
    columns: w.columns.map(c => (c === from ? name : c)),
    tasks: w.tasks.map(t => (t.column === from ? { ...t, column: name } : t)),
  }
}
export function addColumn(w: Workspace, raw: string): Workspace {
  const name = raw.trim()
  if (!name || w.columns.includes(name)) throw new Error("Choose a new, nonempty column name.")
  return { ...w, columns: [...w.columns, name] }
}
export function setLabelColor(w: Workspace, id: string, color: string): Workspace {
  if (!isHexColor(color)) throw new Error("Use a hex color such as #ff8800.")
  if (!w.labels.some(l => l.id === id)) throw new Error("Label not found.")
  return { ...w, labels: w.labels.map(l => (l.id === id ? { ...l, color: color.toLowerCase() } : l)) }
}
export function deleteLabel(w: Workspace, id: string): Workspace {
  if (!w.labels.some(l => l.id === id)) throw new Error("Label not found.")
  return {
    ...w,
    labels: w.labels.filter(l => l.id !== id),
    tasks: w.tasks.map(t => (t.labels.includes(id) ? { ...t, labels: t.labels.filter(l => l !== id) } : t)),
  }
}
/** Saved pen colors: unique, lower-case hex, most recent last, capped. */
export function addPaletteColor(w: Workspace, color: string): Workspace {
  if (!isHexColor(color)) throw new Error("Use a hex color such as #ff8800.")
  const value = color.toLowerCase()
  const palette = w.palette ?? DEFAULT_PALETTE
  if (palette.includes(value)) return w
  return { ...w, palette: [...palette, value].slice(-24) }
}
export function removePaletteColor(w: Workspace, color: string): Workspace {
  return { ...w, palette: (w.palette ?? DEFAULT_PALETTE).filter(c => c !== color.toLowerCase()) }
}
export type FontChoice = {
  /** CSS family name. */
  family: string
  source: "google" | "file"
  /** Stylesheet URL for Google fonts. */
  href?: string
}
/** Fills in fields added after a workspace was first saved, without touching user data. */
export function normalizeWorkspace(saved: Workspace): Workspace {
  return {
    ...saved,
    objects: saved.objects ?? [],
    palette: Array.isArray(saved.palette) ? saved.palette.filter(isHexColor) : [...DEFAULT_PALETTE],
    penWidth: typeof saved.penWidth === "number" ? saved.penWidth : 3,
    penColor: isHexColor(saved.penColor) ? saved.penColor : undefined,
  }
}
export function isWorkspace(value: unknown): value is Workspace {
  const saved = value as Workspace | null
  return (
    !!saved &&
    typeof saved === "object" &&
    saved.schema === 1 &&
    Array.isArray(saved.tasks) &&
    Array.isArray(saved.commits) &&
    Array.isArray(saved.columns) &&
    Array.isArray(saved.labels) &&
    Array.isArray(saved.strokes) &&
    Array.isArray(saved.proposals) &&
    Array.isArray(saved.merged)
  )
}
export type Snapshot = {
  tasks: Task[]
  columns: string[]
  labels: Label[]
  strokes: Stroke[]
  notes: string
  objects: WhiteboardObject[]
}
export type Proposal = {
  id: string
  title: string
  source: string
  taskId?: string
  done?: boolean
}
export type Commit = {
  id: string
  message: string
  date: string
  snapshot: Snapshot
}
export type Workspace = Snapshot & {
  schema: 1
  commits: Commit[]
  proposals: Proposal[]
  merged: string[]
  accent: string
  theme: string
  scanlines: boolean
  /** Saved pen colors for the whiteboard. */
  palette?: string[]
  penWidth?: number
  penColor?: string
  /** ISO time of the last change; used to pick the newer copy when syncing. */
  updated?: string
}
export const uid = () => crypto.randomUUID()
export function initialWorkspace(): Workspace {
  return {
    schema: 1,
    tasks: [],
    columns: ["Backlog", "In progress", "Done"],
    labels: [],
    strokes: [],
    notes: "",
    objects: [],
    commits: [],
    proposals: [],
    merged: [],
    accent: "#777777",
    theme: "original",
    scanlines: false,
    palette: [...DEFAULT_PALETTE],
    penWidth: 3,
  }
}
export function snapshot(w: Workspace): Snapshot {
  return structuredClone({
    tasks: w.tasks,
    columns: w.columns,
    labels: w.labels,
    strokes: w.strokes,
    notes: w.notes,
    objects: w.objects ?? [],
  })
}
export function checkpoint(w: Workspace, message: string): Workspace {
  return {
    ...w,
    commits: [
      ...w.commits,
      {
        id: uid(),
        message,
        date: new Date().toISOString(),
        snapshot: snapshot(w),
      },
    ],
  }
}
export function revert(w: Workspace, id: string): Workspace {
  const commit = w.commits.find((c) => c.id === id)
  if (!commit) throw new Error("Checkpoint not found.")
  const before = checkpoint(w, `Before restore of ${id.slice(0, 8)}`)
  return checkpoint(
    {
      ...before,
      ...structuredClone(commit.snapshot),
      objects: structuredClone(commit.snapshot.objects ?? []),
    },
    `Restored ${id.slice(0, 8)}`
  )
}
export function addTask(w: Workspace, title: string): Workspace {
  if (!title.trim()) throw new Error("A task needs a title.")
  return {
    ...w,
    tasks: [
      ...w.tasks,
      {
        id: uid(),
        title: title.trim(),
        column: w.columns[0],
        done: false,
        submission: "none",
        labels: [],
        created: new Date().toISOString(),
        comments: [],
      },
    ],
  }
}
export function addWhiteboardObject(
  w: Workspace,
  kind: WhiteboardObject["kind"],
  text = "",
  center?: { x: number; y: number }
): Workspace {
  const index = (w.objects ?? []).length
  const item: WhiteboardObject = {
    id: uid(),
    kind,
    text,
    x: 160 + (index % 3) * 290,
    y: 110 + Math.floor(index / 3) * 280,
    width:
      kind === "kanban" ? 720 : kind === "document" ? 420 : kind === "text" ? 280 : 240,
    height:
      kind === "kanban"
        ? 420
        : kind === "document"
          ? 460
          : kind === "arrow"
            ? 100
            : kind === "text"
              ? 90
              : kind === "link"
                ? 96
                : 220,
  }
  if (kind === "sticky") item.color = STICKY_COLORS[0]
  if (kind === "text") item.fontSize = 18
  if (center) {
    // Cascade successive items so a new one never hides exactly behind the last.
    const step = (index % 6) * 28
    item.x = center.x - item.width / 2 + step
    item.y = center.y - item.height / 2 + step
  }
  return { ...w, objects: [...(w.objects ?? []), item] }
}
export function deleteTask(w: Workspace, id: string): Workspace {
  const task = w.tasks.find((t) => t.id === id)
  if (!task) throw new Error("Task not found.")
  const saved = checkpoint(w, `Before deleting task: ${task.title}`)
  return { ...saved, tasks: saved.tasks.filter((t) => t.id !== id) }
}

export function deleteColumn(w: Workspace, name: string): Workspace {
  if (!w.columns.includes(name)) throw new Error("Column not found.")
  if (w.columns.length === 1)
    throw new Error("Keep at least one column. Create another column first.")
  const saved = checkpoint(w, `Before deleting column: ${name}`)
  const columns = saved.columns.filter((c) => c !== name)
  return {
    ...saved,
    columns,
    tasks: saved.tasks.map((t) =>
      t.column === name ? { ...t, column: columns[0] } : t
    ),
  }
}

export function updateTask(
  w: Workspace,
  id: string,
  patch: Partial<Task>
): Workspace {
  if (!w.tasks.some((t) => t.id === id)) throw new Error("Task not found.")
  return {
    ...w,
    tasks: w.tasks.map((t) => {
      if (t.id !== id) return t
      const next = { ...t, ...patch, id: t.id }
      if (patch.submission === "submitted") next.done = true
      if (next.done && !t.done) next.completed = new Date().toISOString()
      if (!next.done) delete next.completed
      return next
    }),
  }
}
export function mergeProposal(w: Workspace, id: string): Workspace {
  const p = w.proposals.find((p) => p.id === id)
  if (!p) throw new Error("Proposal not found.")
  if (w.merged.includes(id))
    throw new Error("This proposal has already been merged.")
  let next = checkpoint(w, `Before merge: ${p.title}`)
  if (p.taskId)
    next = updateTask(next, p.taskId, {
      title: p.title,
      ...(p.done !== undefined ? { done: p.done } : {}),
    })
  else {
    next = addTask(next, p.title)
    if (p.done !== undefined)
      next = updateTask(next, next.tasks.at(-1)!.id, { done: p.done })
  }
  return checkpoint(
    {
      ...next,
      proposals: next.proposals.filter((p) => p.id !== id),
      merged: [...next.merged, id],
    },
    `Merged: ${p.title} (${p.source})`
  )
}
export function parseProposals(raw: string, w: Workspace): Proposal[] {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("Provide a JSON array with at most 100 proposals.")
  const ids = new Set([...w.proposals.map((p) => p.id), ...w.merged])
  return value.map((p: unknown) => {
    if (!p || typeof p !== "object") throw new Error("Invalid proposal.")
    const x = p as Record<string, unknown>
    if (
      typeof x.id !== "string" ||
      !/^[\w.-]+$/.test(x.id) ||
      typeof x.title !== "string" ||
      !x.title.trim() ||
      typeof x.source !== "string" ||
      !x.source.trim()
    )
      throw new Error(
        "Each proposal needs an id (letters, numbers, dots, dashes or underscores), title, and source."
      )
    if (ids.has(x.id)) throw new Error(`Duplicate proposal: ${x.id}`)
    if (
      x.taskId !== undefined &&
      (typeof x.taskId !== "string" || !w.tasks.some((t) => t.id === x.taskId))
    )
      throw new Error("The linked task does not exist. Use its full ID.")
    if (x.done !== undefined && typeof x.done !== "boolean")
      throw new Error("done must be true or false.")
    ids.add(x.id)
    return {
      id: x.id,
      title: x.title,
      source: x.source,
      taskId: x.taskId as string | undefined,
      done: x.done as boolean | undefined,
    }
  })
}
export const HELP = `wb add sticky|kanban|arrow|document|text "Optional text"\nwb add link <task-id>  (ticket node; click it to open the ticket in a split)\ntask new "Your task"\ntask list\ntask done <id> | task reopen <id>\ntask move <id> "Column"\ntask submit <id>\ntask delete <id>\ncolumn delete "Column" (moves tasks to first remaining column)\ncolumn new "Column"\ncolumn rename "Column" "New name"\nlabel new "Name" global|local [#hex]\nlabel color "Name" #hex\nlabel add <task-id> "Name"\ntab terminal|board|canvas|stats|inbox|history|settings\nsplit board|canvas|stats|terminal | split off\ntheme original|phosphor|amber|violet\ncheckpoint "Description"\nrevert <checkpoint-id>  (asks Y/N)\nmerge <proposal-id>  (asks Y/N)\nclear | help\nUse quoted names with spaces. IDs can be unique prefixes.\nTab completes · → accepts the suggestion · ↑/↓ recalls commands.`
export type View =
  | "terminal"
  | "board"
  | "canvas"
  | "stats"
  | "inbox"
  | "history"
  | "settings"
export const VIEWS: View[] = [
  "terminal",
  "board",
  "canvas",
  "stats",
  "inbox",
  "history",
  "settings",
]
export const THEMES: Record<string, string> = {
  original: "#777777",
  phosphor: "#b7f76b",
  amber: "#ffbf69",
  violet: "#c4a1ff",
}
export type CommandResult = {
  workspace: Workspace
  output: string
  view?: View
  split?: View | null
  confirm?: { type: "merge" | "revert"; id: string }
  clear?: boolean
}
export function execute(w: Workspace, input: string, center?: { x: number; y: number }): CommandResult {
  const tokens =
    input
      .match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g)
      ?.map((t) => t.replace(/^(["'])(.*)\1$/, "$2")) ?? []
  const [verb, sub, ...args] = tokens
  const result = (workspace: Workspace, output: string): CommandResult => ({
    workspace,
    output,
  })
  const resolve = <T extends { id: string }>(items: T[], prefix: string) => {
    const exact = items.find((t) => t.id === prefix)
    if (exact) return exact
    const matches = items.filter((t) => prefix && t.id.startsWith(prefix))
    if (matches.length !== 1)
      throw new Error(
        "Use an existing, unambiguous ID. See the relevant tab for IDs."
      )
    return matches[0]
  }
  if (verb === "wb" && sub === "add") {
    const aliases: Record<string, WhiteboardObject["kind"]> = {
      sticky: "sticky",
      note: "sticky",
      kanban: "kanban",
      arrow: "arrow",
      document: "document",
      doc: "document",
      text: "text",
      link: "link",
      ticket: "link",
    }
    if (!Object.hasOwn(aliases, args[0]))
      throw new Error(
        'Use wb add sticky|kanban|arrow|document|text "Optional text", or wb add link <task-id>.'
      )
    if (aliases[args[0]] === "link") {
      const task = args[1] ? resolve(w.tasks, args[1]) : undefined
      const added = addWhiteboardObject(w, "link", "", center)
      return {
        ...result(
          {
            ...added,
            objects: added.objects.map((o, i) =>
              i === added.objects.length - 1 ? { ...o, taskId: task?.id } : o
            ),
          },
          task
            ? `Linked "${task.title}" on the whiteboard. Click the node to open the ticket beside the canvas.`
            : "Added a ticket link. Pick its ticket on the node."
        ),
        view: "canvas",
      }
    }
    const next = addWhiteboardObject(
      w,
      aliases[args[0]],
      args.slice(1).join(" "), center
    )
    return {
      ...result(
        next,
        `Added ${aliases[args[0]]} to the whiteboard. Drag its header to move it; drop an arrow end on an item to connect. Use Fit to see everything.`
      ),
      view: "canvas",
    }
  }
  if (verb === "help") return result(w, HELP)
  if (verb === "clear") return { ...result(w, ""), clear: true }
  if (verb === "tab" && VIEWS.includes(sub as View))
    return { ...result(w, `Opened ${sub}.`), view: sub as View }
  if (verb === "split" && (sub === "off" || VIEWS.includes(sub as View)))
    return {
      ...result(w, `Split ${sub}.`),
      split: sub === "off" ? null : (sub as View),
    }
  if (verb === "theme" && THEMES[sub])
    return result({ ...w, theme: sub, accent: THEMES[sub] }, `Theme: ${sub}.`)
  if (verb === "checkpoint" && sub)
    return result(checkpoint(w, [sub, ...args].join(" ")), "Checkpoint saved.")
  if (verb === "revert" || verb === "merge") {
    const item = resolve<{ id: string }>(
      verb === "revert" ? w.commits : w.proposals,
      sub
    )
    const description =
      verb === "merge"
        ? (() => {
            const p = w.proposals.find((p) => p.id === item.id)!
            const old = w.tasks.find((t) => t.id === p.taskId)
            return `${p.source}: ${old ? `Update "${old.title}" → "${p.title}"${p.done !== undefined ? `; done: ${old.done} → ${p.done}` : ""}` : `Create "${p.title}"`}`
          })()
        : "Restore tasks, columns, labels, drawing and notes. Current work will be checkpointed."
    return {
      ...result(w, `${description}\n${verb} ${item.id.slice(0, 8)}? [Y/N]`),
      confirm: { type: verb, id: item.id },
    }
  }
  if (verb === "task") {
    if (sub === "new")
      return result(addTask(w, args.join(" ")), "Task created.")
    if (sub === "list")
      return result(
        w,
        w.tasks
          .map(
            (t) =>
              `${t.id.slice(0, 8)} [${t.done ? "x" : " "}] ${t.title} · ${t.column}`
          )
          .join("\n") || 'No tasks yet. Try task new "Your first task".'
      )
    const task = resolve(w.tasks, args[0])
    if (sub === "delete")
      return result(
        deleteTask(w, task.id),
        "Task deleted. Restore its checkpoint in History to undo."
      )
    if (sub === "done" || sub === "reopen")
      return result(
        updateTask(w, task.id, { done: sub === "done" }),
        `${task.title}: ${sub}.`
      )
    if (sub === "submit")
      return result(
        updateTask(w, task.id, { submission: "submitted" }),
        "Marked submitted and complete."
      )
    if (sub === "move" && w.columns.includes(args.slice(1).join(" ")))
      return result(
        updateTask(w, task.id, { column: args.slice(1).join(" ") }),
        "Task moved."
      )
  }
  if (verb === "column" && sub === "delete") {
    const next = deleteColumn(w, args.join(" "))
    return result(
      next,
      `Column deleted. Its tasks were moved to "${next.columns[0]}". Restore its checkpoint in History to undo.`
    )
  }
  if (verb === "column" && sub === "new")
    return result(addColumn(w, args.join(" ")), "Column created.")
  if (verb === "column" && sub === "rename") {
    if (args.length !== 2)
      throw new Error('Use column rename "Column" "New name".')
    return result(renameColumn(w, args[0], args[1]), "Column renamed.")
  }
  if (verb === "label" && sub === "color") {
    const label = w.labels.find((l) => l.name === args.slice(0, -1).join(" "))
    if (!label) throw new Error("Create that label first.")
    return result(setLabelColor(w, label.id, args.at(-1) ?? ""), "Label recolored.")
  }
  if (verb === "label" && sub === "new") {
    const color = isHexColor(args.at(-1)) ? args.pop()!.toLowerCase() : w.accent
    const scope = args.at(-1)
    const name = args.slice(0, -1).join(" ").trim()
    if (
      !name ||
      (scope !== "global" && scope !== "local") ||
      w.labels.some((l) => l.name === name)
    )
      throw new Error('Use label new "Unique name" global|local [#hex].')
    return result(
      {
        ...w,
        labels: [...w.labels, { id: uid(), name, scope, color }],
      },
      "Label created."
    )
  }
  if (verb === "label" && sub === "add") {
    const task = resolve(w.tasks, args[0])
    const label = w.labels.find((l) => l.name === args.slice(1).join(" "))
    if (!label) throw new Error("Create that label first.")
    return result(
      updateTask(w, task.id, {
        labels: [...new Set([...task.labels, label.id])],
      }),
      "Label attached."
    )
  }
  throw new Error(
    "Unknown command or arguments. Type help for available commands."
  )
}
