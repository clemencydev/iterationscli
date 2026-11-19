import {
  addChecklistItem,
  addNode,
  bar,
  checklistItem,
  checklistText,
  columnProgress,
  connectNode,
  deleteNode,
  dropColumnRefs,
  findNode,
  nodeColumns,
  nodeProgress,
  progressText,
  removeChecklistItem,
  renameColumnRefs,
  setColumnColor,
  taskProgress,
  updateChecklistItem,
  updateNode,
  type ChecklistItem,
  type ProgressNode,
} from "./progress.ts"
import {
  addFolder,
  deleteFile,
  deleteFolder,
  dropTaskRefs,
  filesText,
  findFile,
  findFolder,
  folderName,
  folderPath,
  normalizeFiles,
  tieFile,
  updateFile,
  updateFolder,
  type FileEntry,
  type Folder,
} from "./files.ts"
import { TEMPLATES } from "./latex.ts"
import {
  fileProject,
  isTexSource,
  projectFiles,
  texProjects,
} from "./files.ts"
import {
  DEFAULT_SCHEME,
  findScheme,
  isDefaultScheme,
  schemeList,
} from "./themes.ts"

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
  /** Steps inside the ticket; ticking them moves its percentage. */
  checklist?: ChecklistItem[]
}
export type Label = {
  id: string
  name: string
  color: string
  scope: "global" | "local"
}
export type Stroke = {
  taskId?: string
  column?: string
  comments?: string[]
  id: string
  points: [number, number][]
  color: string
  /** Pen thickness in canvas units. Older strokes have none and render at 3. */
  width?: number
  /** Id of the drawing this stroke is part of; see `DrawingGroup`. */
  group?: string
}
/**
 * Several pen strokes treated as one drawing: one ID to refer to and one
 * entry on a ticket, however many strokes it took to draw.
 */
export type DrawingGroup = { id: string; name: string }
export const PEN_WIDTHS = [2, 3, 5, 8, 14]
export const DEFAULT_PALETTE = [
  "#e5e5e5",
  "#f87171",
  "#fbbf24",
  "#4ade80",
  "#60a5fa",
  "#c084fc",
]
export const STICKY_COLORS = [
  "#e4b93d",
  "#f08a7b",
  "#7fc98b",
  "#6fb1e8",
  "#b99cf0",
  "#9aa0a6",
]
export const TEXT_SIZES = [14, 18, 24, 36, 56]
export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
export type WhiteboardObject = {
  /** Source item for a shortcut created by selection assignment. */
  generatedFor?: string
  column?: string
  comments?: string[]
  html?: string
  from?: Connection
  to?: Connection
  /** What an arrow draws at each end. Missing means a plain directed arrow. */
  ends?: LineEnds
  locked?: boolean
  id: string
  kind: WhiteboardKind
  /** Sticky tint or free-text color (hex). */
  color?: string
  /** Free-text size in px. */
  fontSize?: number
  /** Ticket a link node points at. */
  taskId?: string
  /** File a file node shows (see lib/files.ts). */
  fileId?: string
  x: number
  y: number
  width: number
  height: number
  text: string
}
/** A marker at the end of a line: nothing, an arrowhead, a dot or a diamond. */
export type LineEnd = "none" | "arrow" | "dot" | "diamond"
export type LineEnds = { start: LineEnd; end: LineEnd }
export const LINE_ENDS: LineEnd[] = ["none", "arrow", "dot", "diamond"]
/** The ends an arrow draws; arrows made before ends existed are directed. */
export const lineEnds = (item: Pick<WhiteboardObject, "ends">): LineEnds =>
  item.ends ?? { start: "none", end: "arrow" }
/** The usual kinds of connection, by the names and symbols people type. */
export const LINK_STYLES: Record<string, LineEnds> = {
  directed: { start: "none", end: "arrow" },
  "->": { start: "none", end: "arrow" },
  undirected: { start: "none", end: "none" },
  line: { start: "none", end: "none" },
  "--": { start: "none", end: "none" },
  both: { start: "arrow", end: "arrow" },
  "<->": { start: "arrow", end: "arrow" },
  reverse: { start: "arrow", end: "none" },
  "<-": { start: "arrow", end: "none" },
}
/** "A -> B", "A -- B", … : how a connection reads in text. */
export function linkSymbol(ends: LineEnds) {
  const mark = (end: LineEnd, arrow: string) =>
    end === "arrow" ? arrow : end === "dot" ? "o" : end === "diamond" ? "<>" : ""
  return `${mark(ends.start, "<")}--${mark(ends.end, ">")}`.replace("---", "--")
}
/** A canvas item in a few words: what completion and listings show. */
export function describeObject(
  o: WhiteboardObject,
  w: Pick<Workspace, "tasks" | "files">
) {
  const text =
    o.kind === "link"
      ? (w.tasks.find((t) => t.id === o.taskId)?.title ?? "no ticket")
      : o.kind === "file"
        ? ((w.files ?? []).find((f) => f.id === o.fileId)?.name ?? "no file")
        : o.text.replace(/\s+/g, " ").trim()
  return `${o.kind}${text ? `: ${text.slice(0, 48)}` : ""}`
}
/**
 * Connects two canvas items with an arrow between the sides that face each
 * other. `ends` chooses directed (the default), undirected, both ways…
 */
export function linkItems(
  w: Workspace,
  fromId: string,
  toId: string,
  ends: LineEnds = { start: "none", end: "arrow" },
  label = ""
): Workspace {
  const from = w.objects.find((o) => o.id === fromId && o.kind !== "arrow")
  const to = w.objects.find((o) => o.id === toId && o.kind !== "arrow")
  if (!from || !to || from.id === to.id)
    throw new Error("Connect two different items.")
  const [fromSide, toSide] = facingSides(from, to)
  const next = connectObjects(
    w,
    { objectId: from.id, side: fromSide },
    { objectId: to.id, side: toSide }
  )
  return {
    ...next,
    objects: next.objects.map((o, i) =>
      i === next.objects.length - 1 ? { ...o, ends, text: label } : o
    ),
  }
}
/** Removes every arrow between two items, whichever way it points. */
export function unlinkItems(w: Workspace, a: string, b: string): Workspace {
  const joins = (o: WhiteboardObject) =>
    o.kind === "arrow" &&
    ((o.from?.objectId === a && o.to?.objectId === b) ||
      (o.from?.objectId === b && o.to?.objectId === a))
  if (!w.objects.some(joins)) throw new Error("Those two are not connected.")
  return { ...w, objects: w.objects.filter((o) => !joins(o)) }
}
/** Derive reciprocal links from current objects, so relinking/deleting never leaves stale ticket references. */
export function ticketCanvasItems(w: Workspace, taskId: string) {
  const ids = new Set(
    w.objects.filter((o) => o.taskId === taskId).map((o) => o.id)
  )
  for (const arrow of w.objects.filter((o) => o.kind === "arrow")) {
    const from = w.objects.find((o) => o.id === arrow.from?.objectId)
    const to = w.objects.find((o) => o.id === arrow.to?.objectId)
    if (from?.kind === "link" && from.taskId === taskId && to) ids.add(to.id)
    if (to?.kind === "link" && to.taskId === taskId && from) ids.add(from.id)
  }
  return [
    ...w.objects
      .filter((o) => ids.has(o.id))
      .map((o) => ({
        id: o.id,
        kind: o.kind as string,
        title:
          o.text.trim().slice(0, 80) ||
          (o.kind === "link" ? "Ticket shortcut" : o.kind),
      })),
    // A drawing made of many strokes is one entry, under its name.
    ...drawingGroups(w)
      .filter((g) => g.strokes.some((s) => s.taskId === taskId))
      .map((g) => ({ id: g.id, kind: "drawing", title: g.name })),
    ...w.strokes
      .filter((s) => s.taskId === taskId && !s.group)
      .map((s) => ({ id: s.id, kind: "drawing", title: "Linked drawing" })),
  ]
}
/**
 * The ticket an arrow key moves to on the task board: up and down within a
 * column, left and right to the nearest column that has tickets (keeping the
 * row where it can). With no ticket selected yet, the first one on the board.
 */
export function boardNeighbour(
  columns: string[],
  tasks: Pick<Task, "id" | "column">[],
  current: string | undefined,
  direction: "left" | "right" | "up" | "down"
): string | undefined {
  const grid = columns.map((column) =>
    tasks.filter((t) => t.column === column).map((t) => t.id)
  )
  const at = grid.findIndex((ids) => current !== undefined && ids.includes(current))
  if (at < 0) return grid.find((ids) => ids.length)?.[0]
  const row = grid[at].indexOf(current!)
  if (direction === "up" || direction === "down")
    return grid[at][row + (direction === "up" ? -1 : 1)]
  const step = direction === "left" ? -1 : 1
  for (let c = at + step; c >= 0 && c < grid.length; c += step)
    if (grid[c].length) return grid[c][Math.min(row, grid[c].length - 1)]
  return undefined
}
/** The drawings on the canvas: each group that still has strokes, with them. */
export function drawingGroups(w: Pick<Workspace, "strokes" | "groups">) {
  return (w.groups ?? [])
    .map((group) => ({
      ...group,
      strokes: w.strokes.filter((s) => s.group === group.id),
    }))
    .filter((group) => group.strokes.length > 0)
}
/**
 * Makes one drawing out of the given strokes (taking them out of any drawing
 * they were in) and returns its id. Drawings left without strokes disappear.
 */
export function groupStrokes(
  w: Workspace,
  strokeIds: string[],
  name = ""
): { workspace: Workspace; id: string } {
  const chosen = new Set(strokeIds)
  if (!w.strokes.some((s) => chosen.has(s.id)))
    throw new Error("Select some pen strokes to group.")
  const id = uid()
  const strokes = w.strokes.map((s) =>
    chosen.has(s.id) ? { ...s, group: id } : s
  )
  const used = new Set(strokes.map((s) => s.group))
  const count = (w.groups ?? []).filter((g) => used.has(g.id)).length
  return {
    id,
    workspace: {
      ...w,
      strokes,
      groups: [
        ...(w.groups ?? []).filter((g) => used.has(g.id)),
        { id, name: name.trim() || `Drawing ${count + 1}` },
      ],
    },
  }
}
/** Renames a drawing. */
export function nameGroup(w: Workspace, id: string, name: string): Workspace {
  if (!name.trim()) throw new Error("A drawing needs a name.")
  if (!(w.groups ?? []).some((g) => g.id === id))
    throw new Error("Drawing not found.")
  return {
    ...w,
    groups: (w.groups ?? []).map((g) =>
      g.id === id ? { ...g, name: name.trim() } : g
    ),
  }
}
/** Breaks a drawing back into loose strokes. */
export function ungroup(w: Workspace, id: string): Workspace {
  return {
    ...w,
    strokes: w.strokes.map((s) => {
      if (s.group !== id) return s
      const rest = { ...s }
      delete rest.group
      return rest
    }),
    groups: (w.groups ?? []).filter((g) => g.id !== id),
  }
}
export type WhiteboardKind =
  | "sticky"
  | "kanban"
  | "arrow"
  | "document"
  | "text"
  | "link"
  | "file"
export const WHITEBOARD_KINDS: WhiteboardKind[] = [
  "sticky",
  "kanban",
  "arrow",
  "document",
  "text",
  "link",
  "file",
]
export type Connection = {
  objectId: string
  side: "top" | "right" | "bottom" | "left"
}
export function connectionPoint(
  object: WhiteboardObject,
  side: Connection["side"]
) {
  return {
    x:
      object.x +
      (side === "left"
        ? 0
        : side === "right"
          ? object.width
          : object.width / 2),
    y:
      object.y +
      (side === "top"
        ? 0
        : side === "bottom"
          ? object.height
          : object.height / 2),
  }
}
export function resolveArrow(
  item: WhiteboardObject,
  objects: WhiteboardObject[]
): WhiteboardObject {
  if (item.kind !== "arrow") return item
  const source = objects.find((o) => o.id === item.from?.objectId)
  const target = objects.find((o) => o.id === item.to?.objectId)
  const start =
    source && item.from
      ? connectionPoint(source, item.from.side)
      : { x: item.x, y: item.y }
  const end =
    target && item.to
      ? connectionPoint(target, item.to.side)
      : { x: item.x + item.width, y: item.y + item.height }
  return {
    ...item,
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
  }
}
export function connectObjects(
  w: Workspace,
  from: Connection,
  to: Connection
): Workspace {
  const source = w.objects.find(
    (o) => o.id === from.objectId && o.kind !== "arrow"
  )
  const target = w.objects.find(
    (o) => o.id === to.objectId && o.kind !== "arrow"
  )
  if (!source || !target || source.id === target.id)
    throw new Error("Connect two different items.")
  const start = connectionPoint(source, from.side),
    end = connectionPoint(target, to.side)
  return {
    ...w,
    objects: [
      ...w.objects,
      {
        id: uid(),
        kind: "arrow",
        text: "",
        x: start.x,
        y: start.y,
        width: end.x - start.x,
        height: end.y - start.y,
        from,
        to,
      },
    ],
  }
}
/** Side of `object` closest to a point; used when an arrow end is dropped on an item. */
export function nearestSide(
  object: WhiteboardObject,
  point: { x: number; y: number }
): Connection["side"] {
  const sides = ["top", "right", "bottom", "left"] as const
  let best: Connection["side"] = "top",
    distance = Infinity
  for (const side of sides) {
    const p = connectionPoint(object, side)
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2
    if (d < distance) {
      distance = d
      best = side
    }
  }
  return best
}
/** Topmost connectable item under a point (arrows never accept connections). */
export function objectAt(
  objects: WhiteboardObject[],
  point: { x: number; y: number },
  exclude?: string,
  margin = 12
): WhiteboardObject | undefined {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]
    if (o.kind === "arrow" || o.id === exclude) continue
    if (
      point.x >= o.x - margin &&
      point.x <= o.x + o.width + margin &&
      point.y >= o.y - margin &&
      point.y <= o.y + o.height + margin
    )
      return o
  }
}
/** Sides that face each other, so a new arrow takes the short way between two items. */
export function facingSides(
  a: WhiteboardObject,
  b: WhiteboardObject
): [Connection["side"], Connection["side"]] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2),
    dy = b.y + b.height / 2 - (a.y + a.height / 2)
  if (Math.abs(dx) >= Math.abs(dy))
    return dx >= 0 ? ["right", "left"] : ["left", "right"]
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"]
}
/** Adds a ticket link node beside an item and connects the two with an arrow. */
export function linkObjectToTask(
  w: Workspace,
  objectId: string,
  taskId?: string
): Workspace {
  const source = w.objects.find((o) => o.id === objectId && o.kind !== "arrow")
  if (!source) throw new Error("Whiteboard item not found.")
  if (taskId !== undefined && !w.tasks.some((t) => t.id === taskId))
    throw new Error("Task not found.")
  const node: WhiteboardObject = {
    id: uid(),
    kind: "link",
    text: "",
    taskId,
    x: source.x + source.width + 90,
    y: source.y + source.height / 2 - 48,
    width: 240,
    height: 96,
  }
  const next = { ...w, objects: [...w.objects, node] }
  return connectObjects(
    next,
    { objectId: source.id, side: "right" },
    { objectId: node.id, side: "left" }
  )
}
export function renameColumn(
  w: Workspace,
  from: string,
  to: string
): Workspace {
  const name = to.trim()
  if (!w.columns.includes(from)) throw new Error("Column not found.")
  if (!name) throw new Error("A column needs a name.")
  if (name === from) return w
  if (w.columns.includes(name))
    throw new Error("A column with that name already exists.")
  return renameColumnRefs(
    {
      ...w,
      columns: w.columns.map((c) => (c === from ? name : c)),
      tasks: w.tasks.map((t) =>
        t.column === from ? { ...t, column: name } : t
      ),
    },
    from,
    name
  )
}
export function addColumn(w: Workspace, raw: string): Workspace {
  const name = raw.trim()
  if (!name || w.columns.includes(name))
    throw new Error("Choose a new, nonempty column name.")
  return { ...w, columns: [...w.columns, name] }
}
export function setLabelColor(
  w: Workspace,
  id: string,
  color: string
): Workspace {
  if (!isHexColor(color)) throw new Error("Use a hex color such as #ff8800.")
  if (!w.labels.some((l) => l.id === id)) throw new Error("Label not found.")
  return {
    ...w,
    labels: w.labels.map((l) =>
      l.id === id ? { ...l, color: color.toLowerCase() } : l
    ),
  }
}
export function deleteLabel(w: Workspace, id: string): Workspace {
  if (!w.labels.some((l) => l.id === id)) throw new Error("Label not found.")
  return {
    ...w,
    labels: w.labels.filter((l) => l.id !== id),
    tasks: w.tasks.map((t) =>
      t.labels.includes(id)
        ? { ...t, labels: t.labels.filter((l) => l !== id) }
        : t
    ),
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
  return {
    ...w,
    palette: (w.palette ?? DEFAULT_PALETTE).filter(
      (c) => c !== color.toLowerCase()
    ),
  }
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
  const columns = new Set(saved.columns)
  return {
    ...saved,
    ...normalizeFiles(saved),
    columnColors: Object.fromEntries(
      Object.entries(saved.columnColors ?? {}).filter(
        ([column, color]) => columns.has(column) && isHexColor(color)
      )
    ),
    nodes: Array.isArray(saved.nodes)
      ? saved.nodes
          .filter(
            (n) =>
              typeof n?.id === "string" &&
              typeof n?.name === "string" &&
              Array.isArray(n?.columns)
          )
          .map((n) => ({
            ...n,
            columns: n.columns.filter((c) => columns.has(c)),
          }))
      : [],
    objects: saved.objects ?? [],
    palette: Array.isArray(saved.palette)
      ? saved.palette.filter(isHexColor)
      : [...DEFAULT_PALETTE],
    penWidth: typeof saved.penWidth === "number" ? saved.penWidth : 3,
    penColor: isHexColor(saved.penColor) ? saved.penColor : undefined,
    groups: Array.isArray(saved.groups)
      ? saved.groups.filter(
          (g) => typeof g?.id === "string" && typeof g?.name === "string"
        )
      : [],
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
  /** Named drawings: pen strokes grouped under one id. */
  groups?: DrawingGroup[]
  /** ISO time of the last change; used to pick the newer copy when syncing. */
  updated?: string
  /** Color of each column's completion bar, by column name. */
  columnColors?: Record<string, string>
  /** Nodes that combine the completion of several columns. */
  nodes?: ProgressNode[]
  /** The file explorer: folders, and the files imported into the workspace. */
  folders?: Folder[]
  files?: FileEntry[]
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
    columnColors: {},
    nodes: [],
    folders: [],
    files: [],
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
      kind === "kanban"
        ? 720
        : kind === "document"
          ? 420
          : kind === "text"
            ? 280
            : kind === "file"
              ? 300
              : 240,
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
                : kind === "file"
                  ? 260
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
  // Its folder stays, as an ordinary folder, with the files that were in it.
  return dropTaskRefs(
    { ...saved, tasks: saved.tasks.filter((t) => t.id !== id) },
    id
  )
}

export function deleteColumn(w: Workspace, name: string): Workspace {
  if (!w.columns.includes(name)) throw new Error("Column not found.")
  if (w.columns.length === 1)
    throw new Error("Keep at least one column. Create another column first.")
  const saved = checkpoint(w, `Before deleting column: ${name}`)
  const columns = saved.columns.filter((c) => c !== name)
  return dropColumnRefs(
    {
      ...saved,
      columns,
      tasks: saved.tasks.map((t) =>
        t.column === name ? { ...t, column: columns[0] } : t
      ),
    },
    name
  )
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
export const HELP = `BOARD
  board (ls)                          Print the board: columns and their tasks
  task new "Title"                    Create a task
  task list                           List every task
  find "text"                         Search task titles
  task show <id>                      Print a ticket
  task open <id>                      Open a ticket beside the current view
  task done|reopen|submit <id>        Change its status
  task move <id> "Column"             Move it to a column
  task rename <id> "New title"        Rename it
  task comment <id> "Text"            Add a comment
  task delete <id>                    Delete it (undo from history)
  check list|add|done|undo|remove     Checklist inside a ticket:
                                      check add <id> "Step" · check done <id> 2
  column list|new|rename|delete       column rename "Column" "New name"
  column color "Column" #hex|reset    Color of the column's completion bar
  progress                            Every column's bar with each ticket's share
  node list|new|connect|disconnect    A node combines the completion of columns:
       color|rename|delete            node new "Release" "Backlog" "Done"
                                      node connect "Release" "In progress"
                                      node color "Release" #hex|reset
  label list|new|add|color            label new "Name" global|local [#hex]
                                      label add <task-id> "Name" · label color "Name" #hex
CANVAS
  wb add sticky|text|document|kanban|arrow "Optional text"
  wb add link <task-id>               Ticket node; click it to open the ticket
  wb add file <file-id>               A file from the explorer, on the canvas
  wb list                             Every canvas item, arrow and drawing with its ID
  link <from> <to> [style] ["label"]  Connect two items. Style: directed (default),
                                      undirected, both, reverse  (or -> -- <-> <-)
  unlink <a> <b>                      Remove the connection between two items
  ends <arrow-id> <start> <end>       Line ends: none arrow dot diamond
  wb name <drawing-id> "Name"         Name a group of pen strokes
FILES
  explorer                           Open the floating file explorer
  files ["filter"]                    The explorer as text; a filter searches every folder
  folder list|new|color|rename        folder new "Name" [#hex] ["Parent folder"]
         ticket|delete                folder color "Name" #hex|reset
                                      folder ticket "Name" <task-id>|none
  file open <file-id>                 Open a file in Annotate
  file tie|untie <file-id> <task-id>  Tie a file to a ticket
  file move <file-id> "Folder"|/      Move it to a folder (/ is the top level)
  file rename|delete <file-id>        file rename <file-id> "New name"
VIEWS
LATEX
  tex templates                       The templates a document can start from
  tex new "Name" [template]           New document (default template: article)
  tex list                            Documents and their files
  tex open <file-id or "Document">    Open one in the LaTeX editor
VIEWS
  cd <view>  (tab <view>)             terminal board canvas files annotate latex
                                      stats inbox history settings
  vsplit [view]                       Split side by side; no view asks what to open
  hsplit [view]                       Split top and bottom
  close <view> · only                 Close a pane · keep only this one
                                      Views also answer to whiteboard, statistics,
                                      incoming, customize, tasks, notes, explorer,
                                      annotations
HISTORY
  undo · redo                         Step back and forward (Ctrl+Z · Ctrl+Shift+Z)
  checkpoint "Description"            Save a restore point
  log                                 List restore points
  revert <checkpoint-id>              Restore one (asks Y/N)
  inbox                               List incoming proposals
  merge <proposal-id>                 Merge one (asks Y/N)
SHELL
  stats                               Progress at a glance
  theme list                          Site themes: the schemes a terminal ships with
  theme <name>                        campbell, campbell-powershell, solarized-dark,
                                      one-half-dark, tango-dark, ubuntu … · default
  theme phosphor|amber|violet         Accent color only
  shell auto|powershell|bash|zsh      Change how this terminal looks
  history · pwd · whoami · clear (cls) · exit · help
KEYS
  Tab        complete (again to cycle, Shift+Tab back) · → accepts the suggestion
  ↑ / ↓      previous / next command · Ctrl+R search history
  Ctrl+L     clear · Ctrl+C cancel · Esc clear the line
  Home/End   start / end of line (Ctrl+A/E in bash and zsh) · Alt+←/→ by word
  Ctrl+U/K   cut to start / end of line · Ctrl+Backspace cut a word
  Ctrl+\`     jump to the prompt · Ctrl+Y terminal window
  Ctrl+\\     split side by side · Ctrl+Shift+\\ split top and bottom (V / H outside text)
  F6         next pane (Shift+F6 previous) · X closes a pane (outside text)
Quote names with spaces. IDs can be unique prefixes.`
export type View =
  | "terminal"
  | "board"
  | "canvas"
  | "files"
  | "annotate"
  | "latex"
  | "stats"
  | "inbox"
  | "history"
  | "settings"
export const VIEWS: View[] = [
  "terminal",
  "board",
  "canvas",
  "files",
  "annotate",
  "latex",
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
/** Other names people use for the views, e.g. `vsplit whiteboard`. */
const VIEW_ALIASES: Record<string, View> = {
  term: "terminal",
  shell: "terminal",
  tasks: "board",
  kanban: "board",
  taskboard: "board",
  whiteboard: "canvas",
  wb: "canvas",
  notes: "canvas",
  sticky: "canvas",
  stickies: "canvas",
  statistics: "stats",
  incoming: "inbox",
  customize: "settings",
  customise: "settings",
  explorer: "files",
  folders: "files",
  file: "files",
  annotations: "annotate",
  annotation: "annotate",
  annotator: "annotate",
  tex: "latex",
  documents: "latex",
  pdf: "latex",
}
/** The view a word names, or undefined. */
export function resolveView(word: string | undefined): View | undefined {
  const key = word?.toLowerCase() ?? ""
  if (VIEWS.includes(key as View)) return key as View
  return Object.hasOwn(VIEW_ALIASES, key) ? VIEW_ALIASES[key] : undefined
}
export type CommandResult = {
  workspace: Workspace
  output: string
  view?: View
  /** A change to the pane layout. A null view opens an empty pane that asks. */
  pane?:
    | { op: "split"; direction: "row" | "column"; view: View | null }
    | { op: "close"; view: View }
    | { op: "only" }
  confirm?: { type: "merge" | "revert"; id: string }
  explorer?: boolean
  clear?: boolean
  /** `cd`: go to a view without leaving the terminal. */
  go?: View
  /** Task to open in a pane beside the current view. */
  ticket?: string
  /** Site theme to switch this device to: a scheme id, or "default". */
  scheme?: string
  /** File to open in Annotate. */
  file?: string
  /** LaTeX: a document to make from a template, or one to open. */
  latex?:
    | { create: { name: string; template: string } }
    | { open: { folder: string | undefined; file?: string } }
}
/** What a command may need to know about the device it runs on. */
export type CommandContext = {
  /** The site theme in use here, for `theme list`. */
  scheme?: string
}

const shortId = (id: string) => id.slice(0, 8)
/** An ISO time as local "2026-11-18 14:05". */
function day(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const two = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
function taskLine(w: Workspace, t: Task) {
  const labels = t.labels
    .map((id) => w.labels.find((l) => l.id === id)?.name)
    .filter(Boolean)
    .map((name) => ` #${name}`)
    .join("")
  const steps = t.checklist?.length
    ? `  (${t.checklist.filter((item) => item.done).length}/${t.checklist.length})`
    : ""
  return `${shortId(t.id)}  [${t.done ? "x" : " "}] ${t.title}${steps}${labels}`
}
/** The board as text: every column with its tasks. */
export function boardText(w: Workspace) {
  return w.columns
    .map((column) => {
      const tasks = w.tasks.filter((t) => t.column === column)
      return [
        `${column} (${tasks.length})`,
        ...(tasks.length
          ? tasks.map((t) => `  ${taskLine(w, t)}`)
          : ["  (empty)"]),
      ].join("\n")
    })
    .join("\n")
}
/** One ticket as text. */
export function ticketText(w: Workspace, t: Task) {
  const labels = t.labels
    .map((id) => w.labels.find((l) => l.id === id)?.name)
    .filter(Boolean)
  const rows = [
    ["Column", t.column],
    [
      "Status",
      t.done
        ? `done${t.completed ? ` (${day(t.completed)})` : ""}`
        : "open",
    ],
    ["Submission", t.submission],
    ["Labels", labels.length ? labels.join(", ") : "none"],
    ["Created", day(t.created)],
    ["Progress", `${Math.round(taskProgress(t) * 100)}%`],
  ]
  const list = t.checklist ?? []
  return [
    `${shortId(t.id)}  ${t.title}`,
    ...rows.map(([name, value]) => `  ${name.padEnd(11)}${value}`),
    ...(list.length
      ? [
          `  ${"Checklist".padEnd(11)}${list.filter((item) => item.done).length}/${list.length}`,
          ...list.map(
            (item, i) => `    ${i + 1}. [${item.done ? "x" : " "}] ${item.text}`
          ),
        ]
      : []),
    `  ${"Comments".padEnd(11)}${t.comments.length || "none"}`,
    ...t.comments.map((comment, i) => `    ${i + 1}. ${comment}`),
  ].join("\n")
}
/** Progress summary with a bar per column. */
export function statsText(w: Workspace) {
  const done = w.tasks.filter((t) => t.done).length
  const total = w.tasks.length
  const waiting = w.tasks.filter((t) => t.submission === "pending" && t.done)
  const width = Math.max(...w.columns.map((c) => c.length), 6)
  const most = Math.max(
    1,
    ...w.columns.map((c) => w.tasks.filter((t) => t.column === c).length)
  )
  return [
    `${total} task${total === 1 ? "" : "s"} · ${done} done (${total ? Math.round((done / total) * 100) : 0}%) · ${waiting.length} awaiting submission`,
    ...w.columns.map((column) => {
      const count = w.tasks.filter((t) => t.column === column).length
      return `  ${column.padEnd(width)}  [${"#".repeat(Math.round((count / most) * 20)).padEnd(20, ".")}] ${count}  ·  ${columnProgress(w, column).percent}% complete`
    }),
    ...(w.nodes ?? []).map((node) => {
      const p = nodeProgress(w, node)
      return `  ${node.name}: ${bar(p.percent, 12)} ${p.percent}% of ${nodeColumns(w, node).join(" + ") || "no columns"}`
    }),
  ].join("\n")
}
export function execute(
  w: Workspace,
  input: string,
  center?: { x: number; y: number },
  context: CommandContext = {}
): CommandResult {
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
  const items = w.objects.filter((o) => o.kind !== "arrow")
  const arrows = w.objects.filter((o) => o.kind === "arrow")
  const item = (prefix: string | undefined, what = "canvas item") => {
    if (!prefix) throw new Error(`Name a ${what} by its ID. \`wb list\` shows them.`)
    return resolve(items, prefix)
  }
  if (verb === "link") {
    // link <from> <to> [directed|undirected|both|reverse] ["label"]
    const from = item(sub)
    const to = item(args[0])
    const style = args[1]?.toLowerCase()
    const known = style !== undefined && Object.hasOwn(LINK_STYLES, style)
    const label = args.slice(known ? 2 : 1).join(" ")
    const ends = known ? LINK_STYLES[style] : LINK_STYLES.directed
    return {
      ...result(
        linkItems(w, from.id, to.id, ends, label),
        `${shortId(from.id)} ${linkSymbol(ends)} ${shortId(to.id)}${label ? `  "${label}"` : ""}`
      ),
    }
  }
  if (verb === "unlink") {
    const a = item(sub)
    const b = item(args[0])
    return result(
      unlinkItems(w, a.id, b.id),
      `Disconnected ${shortId(a.id)} and ${shortId(b.id)}.`
    )
  }
  if (verb === "ends") {
    // ends <arrow-id> <start> <end>, or a named style: ends <arrow-id> both
    if (!sub) throw new Error("Use ends <arrow-id> none|arrow|dot|diamond none|arrow|dot|diamond.")
    const arrow = resolve(arrows, sub)
    const style = args[0]?.toLowerCase()
    const ends =
      style !== undefined && Object.hasOwn(LINK_STYLES, style)
        ? LINK_STYLES[style]
        : LINE_ENDS.includes(args[0] as LineEnd) &&
            LINE_ENDS.includes(args[1] as LineEnd)
          ? { start: args[0] as LineEnd, end: args[1] as LineEnd }
          : undefined
    if (!ends)
      throw new Error(
        "Use ends <arrow-id> none|arrow|dot|diamond none|arrow|dot|diamond, or directed|undirected|both|reverse."
      )
    return result(
      {
        ...w,
        objects: w.objects.map((o) => (o.id === arrow.id ? { ...o, ends } : o)),
      },
      `Arrow ${shortId(arrow.id)}: ${linkSymbol(ends)}`
    )
  }
  if (verb === "wb" && sub === "list") {
    const groups = drawingGroups(w)
    const lines = [
      ...items.map((o) => `${shortId(o.id)}  ${describeObject(o, w)}`),
      ...arrows.map((o) => {
        const end = (id?: string) => (id ? shortId(id) : "(loose)")
        return `${shortId(o.id)}  arrow: ${end(o.from?.objectId)} ${linkSymbol(lineEnds(o))} ${end(o.to?.objectId)}${o.text ? `  "${o.text}"` : ""}`
      }),
      ...groups.map(
        (g) =>
          `${shortId(g.id)}  drawing: ${g.name} (${g.strokes.length} stroke${g.strokes.length === 1 ? "" : "s"})`
      ),
    ]
    return result(
      w,
      lines.join("\n") || 'The canvas is empty. Try wb add sticky "Idea".'
    )
  }
  if (verb === "wb" && sub === "name") {
    const group = resolve(drawingGroups(w), args[0] ?? "")
    const name = args.slice(1).join(" ").trim()
    if (!name) throw new Error('Use wb name <drawing-id> "Name".')
    return result(nameGroup(w, group.id, name), `Drawing ${shortId(group.id)} is now "${name}".`)
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
      file: "file",
    }
    if (!Object.hasOwn(aliases, args[0]))
      throw new Error(
        'Use wb add sticky|kanban|arrow|document|text "Optional text", wb add link <task-id> or wb add file <file-id>.'
      )
    if (aliases[args[0]] === "file") {
      const file = args[1] ? findFile(w, args[1]) : undefined
      const added = addWhiteboardObject(w, "file", "", center)
      return {
        ...result(
          {
            ...added,
            objects: added.objects.map((o, i) =>
              i === added.objects.length - 1 ? { ...o, fileId: file?.id } : o
            ),
          },
          file
            ? `Placed "${file.name}" on the whiteboard.`
            : "Added a file node. Pick its file on the node."
        ),
        view: "canvas",
      }
    }
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
      args.slice(1).join(" "),
      center
    )
    return {
      ...result(
        next,
        `Added ${aliases[args[0]]} to the whiteboard. Drag its header to move it; drop an arrow end on an item to connect. Use Fit to see everything.`
      ),
      view: "canvas",
    }
  }
  if (verb === "help" || verb === "man" || verb === "?") return result(w, HELP)
  if (verb === "clear" || verb === "cls")
    return { ...result(w, ""), clear: true }
  if (verb === "tab" && resolveView(sub))
    return { ...result(w, `Opened ${resolveView(sub)}.`), view: resolveView(sub) }
  if (verb === "cd") {
    // Views are the directories of this shell; the terminal is home.
    const target =
      !sub || /^(~|\/|\\|\.\.)$/.test(sub) ? "terminal" : resolveView(sub)
    if (!target)
      throw new Error(`cd: no such view: ${sub}. Views: ${VIEWS.join(" ")}.`)
    return { ...result(w, ""), go: target }
  }
  // vsplit draws a vertical divider (side by side), hsplit a horizontal one
  // (stacked), as in vim. `split` is the older name for vsplit.
  if (verb === "vsplit" || verb === "hsplit" || verb === "split") {
    if (verb === "split" && sub === "off")
      return { ...result(w, "Closed the other panes."), pane: { op: "only" } }
    const view = sub ? resolveView(sub) : null
    if (view === undefined)
      throw new Error(
        `${verb}: no such view: ${sub}. Views: ${VIEWS.join(" ")}.`
      )
    return {
      ...result(w, ""),
      pane: {
        op: "split",
        direction: verb === "hsplit" ? "column" : "row",
        view,
      },
    }
  }
  if (verb === "close") {
    const view = resolveView(sub)
    if (!view)
      throw new Error(`Use close <view>. Views: ${VIEWS.join(" ")}.`)
    return { ...result(w, ""), pane: { op: "close", view } }
  }
  if (verb === "only")
    return { ...result(w, ""), pane: { op: "only" } }
  if (verb === "board" || verb === "ls" || verb === "dir")
    return result(w, boardText(w))
  if (verb === "stats") return result(w, statsText(w))
  if (verb === "find") {
    const needle = [sub, ...args].join(" ").trim().toLowerCase()
    if (!needle) throw new Error('Use find "text".')
    const found = w.tasks.filter((t) => t.title.toLowerCase().includes(needle))
    return result(
      w,
      found.map((t) => `${taskLine(w, t)} · ${t.column}`).join("\n") ||
        `No task matches "${needle}".`
    )
  }
  if (verb === "log")
    return result(
      w,
      [...w.commits]
        .reverse()
        .map((c) => `${shortId(c.id)}  ${day(c.date)}  ${c.message}`)
        .join("\n") || 'No restore points yet. Try checkpoint "Description".'
    )
  if (verb === "inbox")
    return result(
      w,
      w.proposals
        .map((p) => `${p.id}  ${p.source}: ${p.title}`)
        .join("\n") || "Nothing incoming."
    )
  if (verb === "column" && sub === "list")
    return result(
      w,
      w.columns
        .map(
          (c) => `${c} (${w.tasks.filter((t) => t.column === c).length})`
        )
        .join("\n")
    )
  if (verb === "label" && sub === "list")
    return result(
      w,
      w.labels
        .map((l) => `${l.name.padEnd(20)} ${l.scope.padEnd(7)} ${l.color}`)
        .join("\n") || 'No labels yet. Try label new "Name" global.'
    )
  if (verb === "theme") {
    const current = context.scheme ?? DEFAULT_SCHEME
    if (!sub || sub === "list")
      return result(
        w,
        `${schemeList(current)}\nSwitch with theme <name>. Accent only: theme phosphor|amber|violet.`
      )
    const name = [sub, ...args].join(" ")
    // The site's own look: no scheme, and the accent it came with.
    if (isDefaultScheme(name))
      return {
        ...result(
          { ...w, theme: "original", accent: THEMES.original },
          "Theme: default."
        ),
        scheme: DEFAULT_SCHEME,
      }
    if (Object.hasOwn(THEMES, sub) && args.length === 0)
      return result(
        { ...w, theme: sub, accent: THEMES[sub] },
        `Accent: ${sub}.`
      )
    const scheme = findScheme(name)
    if (!scheme)
      throw new Error("Unknown theme. `theme list` shows them all.")
    return { ...result(w, `Theme: ${scheme.name}.`), scheme: scheme.id }
  }
  if (verb === "progress") return result(w, progressText(w))
  if (verb === "check") {
    if (!["list", "add", "done", "undo", "remove"].includes(sub ?? ""))
      throw new Error(
        'Use check list|add|done|undo|remove <task-id>, then "text" to add or an item number.'
      )
    const task = resolve(w.tasks, args[0])
    if (sub === "list") return result(w, checklistText(task))
    const after = (next: Workspace) =>
      result(next, checklistText(next.tasks.find((t) => t.id === task.id)!))
    if (sub === "add")
      return after(addChecklistItem(w, task.id, args.slice(1).join(" ")))
    const target = checklistItem(task, args[1])
    return after(
      sub === "remove"
        ? removeChecklistItem(w, task.id, target.id)
        : updateChecklistItem(w, task.id, target.id, { done: sub === "done" })
    )
  }
  if (verb === "column" && sub === "color") {
    const color = args.at(-1) ?? ""
    const name = args.slice(0, -1).join(" ")
    if (!name) throw new Error('Use column color "Column" #hex, or reset.')
    const reset = color.toLowerCase() === "reset"
    return result(
      setColumnColor(w, name, reset ? undefined : color),
      reset
        ? `${name}: bar color reset.`
        : `${name}: bar color ${color.toLowerCase()}.`
    )
  }
  if (verb === "node") {
    const nodes = w.nodes ?? []
    if (!sub || sub === "list")
      return result(
        w,
        nodes
          .map((node) => {
            const p = nodeProgress(w, node)
            return `${shortId(node.id)}  ${node.name}  ${bar(p.percent)} ${p.percent}%  ${p.done}/${p.total} done  ← ${nodeColumns(w, node).join(" + ") || "no columns"}`
          })
          .join("\n") ||
          'No nodes yet. Try node new "Release" "Backlog" "Done".'
      )
    if (sub === "new") {
      const next = addNode(w, args[0] ?? "", args.slice(1))
      const node = next.nodes!.at(-1)!
      return result(
        next,
        `Node "${node.name}" combines ${node.columns.join(" + ") || "no columns yet. Connect some: node connect"}.`
      )
    }
    if (
      !["connect", "disconnect", "color", "rename", "delete"].includes(sub)
    )
      throw new Error(
        "Use node list|new|connect|disconnect|color|rename|delete."
      )
    const node = findNode(w, args[0])
    if (sub === "delete")
      return result(deleteNode(w, node.id), `Node "${node.name}" deleted.`)
    if (sub === "rename")
      return result(
        updateNode(w, node.id, { name: args.slice(1).join(" ") }),
        "Node renamed."
      )
    if (sub === "color") {
      const reset = (args[1] ?? "").toLowerCase() === "reset"
      return result(
        updateNode(w, node.id, { color: reset ? undefined : (args[1] ?? "") }),
        reset ? "Node color reset." : "Node recolored."
      )
    }
    if (args.length < 2)
      throw new Error(`Use node ${sub} "${node.name}" "Column".`)
    const next = args
      .slice(1)
      .reduce(
        (current, column) =>
          connectNode(current, node.id, column, sub === "connect"),
        w
      )
    const now = next.nodes!.find((n) => n.id === node.id)!
    const p = nodeProgress(next, now)
    return result(
      next,
      `${now.name}: ${nodeColumns(next, now).join(" + ") || "no columns"} · ${p.percent}%`
    )
  }
  if (verb === "explorer" || (verb === "files" && !sub))
    return { ...result(w, verb === "files" ? filesText(w) : "File explorer opened."), explorer: true }
  if (verb === "files" || (verb === "file" && (!sub || sub === "list")))
    return result(
      w,
      filesText(w, verb === "files" ? [sub, ...args].filter(Boolean).join(" ") : "")
    )
  if (verb === "folder") {
    const folders = w.folders ?? []
    if (!sub || sub === "list")
      return result(
        w,
        folders
          .map((f) => {
            const count = (w.files ?? []).filter((x) => x.folder === f.id).length
            return `${shortId(f.id)}  ${folderPath(w, f.id)}/  ${count} file${count === 1 ? "" : "s"}${f.taskId ? "  ticket" : ""}${f.color ? `  ${f.color}` : ""}`
          })
          .join("\n") || 'No folders yet. Try folder new "Name".'
      )
    if (sub === "new") {
      const rest = args.slice(1)
      const color = rest.find((arg) => isHexColor(arg))
      const parent = rest.find((arg) => !isHexColor(arg))
      const added = addFolder(w, args[0] ?? "", {
        color,
        parent: parent ? findFolder(w, parent).id : undefined,
      })
      return result(
        added.workspace,
        `Folder "${folderPath(added.workspace, added.id)}" created.`
      )
    }
    if (!["color", "rename", "ticket", "delete"].includes(sub))
      throw new Error("Use folder list|new|color|rename|ticket|delete.")
    const folder = findFolder(w, args[0])
    const name = folderName(w, folder)
    if (sub === "delete")
      return result(
        deleteFolder(w, folder.id),
        `Folder "${name}" deleted. What was in it moved up a level.`
      )
    if (sub === "rename")
      return result(
        updateFolder(w, folder.id, { name: args.slice(1).join(" ") }),
        "Folder renamed."
      )
    if (sub === "color") {
      const reset = (args[1] ?? "").toLowerCase() === "reset"
      return result(
        updateFolder(w, folder.id, {
          color: reset ? undefined : (args[1] ?? ""),
        }),
        reset ? `${name}: color reset.` : `${name}: ${(args[1] ?? "").toLowerCase()}.`
      )
    }
    const none = /^(none|off|-)$/i.test(args[1] ?? "")
    const task = none ? undefined : resolve(w.tasks, args[1])
    return result(
      updateFolder(w, folder.id, { taskId: task?.id }),
      task
        ? `"${name}" is now the folder of "${task.title}".`
        : `"${name}" no longer belongs to a ticket.`
    )
  }
  if (verb === "tex" || verb === "latex") {
    if (sub === "templates")
      return result(
        w,
        TEMPLATES.map(
          (t) => `${t.id.padEnd(16)} ${t.name.padEnd(22)} ${t.description}`
        ).join("\n")
      )
    if (!sub || sub === "list") {
      const lines = texProjects(w).flatMap((project) => [
        `${project.folder ? shortId(project.folder) : "--------"}  ${project.name}/`,
        ...projectFiles(w, project.folder)
          .filter(({ file }) => isTexSource(file.name))
          .map(({ file, path }) => `  ${shortId(file.id)}  ${path}`),
      ])
      return result(
        w,
        lines.join("\n") ||
          'No LaTeX documents yet. Try tex new "Resume" resume-classic (tex templates lists them).'
      )
    }
    if (sub === "new") {
      const name = (args[0] ?? "").trim()
      if (!name) throw new Error('Use tex new "Name" [template].')
      const template = TEMPLATES.find(
        (t) => t.id === (args[1] ?? "article").toLowerCase()
      )
      if (!template)
        throw new Error(
          `No template called ${args[1]}. \`tex templates\` lists them.`
        )
      return {
        ...result(w, `Making "${name}" from the ${template.name} template…`),
        latex: { create: { name, template: template.id } },
      }
    }
    if (sub === "open") {
      const ref = args.join(" ").trim()
      const project = texProjects(w).find(
        (p) =>
          p.name.toLowerCase() === ref.toLowerCase() ||
          (p.folder && ref && p.folder.startsWith(ref))
      )
      if (project)
        return {
          ...result(w, `Opened "${project.name}".`),
          latex: { open: { folder: project.folder } },
        }
      const file = findFile(w, ref)
      if (!isTexSource(file.name))
        throw new Error(`${file.name} is not a text file LaTeX reads.`)
      return {
        ...result(w, `Opened ${file.name}.`),
        latex: { open: { folder: fileProject(w, file.id), file: file.id } },
      }
    }
    throw new Error("Use tex templates|new|list|open.")
  }
  if (verb === "file") {
    if (!["open", "tie", "untie", "move", "rename", "delete"].includes(sub))
      throw new Error("Use file open|tie|untie|move|rename|delete <file-id>.")
    const file = findFile(w, args[0])
    if (sub === "open")
      return {
        ...result(w, `Opened "${file.name}" in Annotate.`),
        file: file.id,
      }
    if (sub === "delete")
      return result(deleteFile(w, file.id), `"${file.name}" deleted. undo brings it back.`)
    if (sub === "rename")
      return result(
        updateFile(w, file.id, { name: args.slice(1).join(" ") }),
        "File renamed."
      )
    if (sub === "move") {
      const top = !args[1] || /^(\/|\\|~|\.\.)$/.test(args[1])
      const folder = top ? undefined : findFolder(w, args[1])
      return result(
        updateFile(w, file.id, { folder: folder?.id }),
        folder
          ? `Moved to ${folderPath(w, folder.id)}.`
          : "Moved to the top level."
      )
    }
    const task = resolve(w.tasks, args[1])
    return result(
      tieFile(w, file.id, task.id, sub === "tie"),
      sub === "tie"
        ? `"${file.name}" is tied to "${task.title}".`
        : `"${file.name}" is no longer tied to "${task.title}".`
    )
  }
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
          .map((t) => `${taskLine(w, t)} · ${t.column}`)
          .join("\n") || 'No tasks yet. Try task new "Your first task".'
      )
    const task = resolve(w.tasks, args[0])
    if (sub === "show") return result(w, ticketText(w, task))
    if (sub === "open")
      return { ...result(w, `Opened "${task.title}".`), ticket: task.id }
    if (sub === "rename") {
      const title = args.slice(1).join(" ").trim()
      if (!title) throw new Error('Use task rename <id> "New title".')
      return result(updateTask(w, task.id, { title }), "Task renamed.")
    }
    if (sub === "comment") {
      const comment = args.slice(1).join(" ").trim()
      if (!comment) throw new Error('Use task comment <id> "Text".')
      return result(
        updateTask(w, task.id, { comments: [...task.comments, comment] }),
        "Comment added."
      )
    }
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
    return result(
      setLabelColor(w, label.id, args.at(-1) ?? ""),
      "Label recolored."
    )
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
