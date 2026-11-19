// How far along the work is: a ticket's checklist, a column's completion bar
// and the nodes that combine several columns into one figure. Pure, so it runs
// under `node --test`.
import type { Task, Workspace } from "./alpha.ts"

export type ChecklistItem = { id: string; text: string; done: boolean }
/**
 * A node on the task board connected to several columns; it shows their
 * completion combined, counting every ticket in them once.
 */
export type ProgressNode = {
  id: string
  name: string
  /** Names of the columns it is connected to. */
  columns: string[]
  /** Bar color (hex). Missing means the accent color. */
  color?: string
}

const isHex = (value: unknown): value is string =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
const id = () => crypto.randomUUID()

/**
 * How complete one ticket is, from 0 to 1: a completed ticket is 1, otherwise
 * it is the share of its checklist that is ticked (0 without a checklist).
 */
export function taskProgress(task: Pick<Task, "done" | "checklist">): number {
  if (task.done) return 1
  const list = task.checklist ?? []
  if (!list.length) return 0
  return list.filter((item) => item.done).length / list.length
}

export type Progress = {
  /** 0–100, rounded. */
  percent: number
  /** Tickets marked complete. */
  done: number
  total: number
  /** Each ticket's own share, in board order. */
  tasks: { id: string; title: string; progress: number }[]
}

/** Completion of a set of tickets: the average of their own percentages. */
export function progressOf(
  tasks: Pick<Task, "id" | "title" | "done" | "checklist">[]
): Progress {
  const parts = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    progress: taskProgress(t),
  }))
  const sum = parts.reduce((total, part) => total + part.progress, 0)
  return {
    percent: parts.length ? Math.round((sum / parts.length) * 100) : 0,
    done: tasks.filter((t) => t.done).length,
    total: tasks.length,
    tasks: parts,
  }
}

export const columnProgress = (w: Pick<Workspace, "tasks">, column: string) =>
  progressOf(w.tasks.filter((t) => t.column === column))

/** A node's columns that still exist, in board order. */
export const nodeColumns = (
  w: Pick<Workspace, "columns">,
  node: ProgressNode
) => w.columns.filter((column) => node.columns.includes(column))

/** The combined completion of every ticket in a node's columns. */
export function nodeProgress(
  w: Pick<Workspace, "tasks" | "columns">,
  node: ProgressNode
) {
  const columns = nodeColumns(w, node)
  return progressOf(w.tasks.filter((t) => columns.includes(t.column)))
}

/** A text bar such as `[######..............]`. */
export const bar = (percent: number, width = 20) =>
  `[${"#".repeat(Math.round((percent / 100) * width)).padEnd(width, ".")}]`

// ---- Checklists ------------------------------------------------------------

const withChecklist = (
  w: Workspace,
  taskId: string,
  edit: (list: ChecklistItem[]) => ChecklistItem[]
): Workspace => {
  if (!w.tasks.some((t) => t.id === taskId)) throw new Error("Task not found.")
  return {
    ...w,
    tasks: w.tasks.map((t) =>
      t.id === taskId ? { ...t, checklist: edit(t.checklist ?? []) } : t
    ),
  }
}

export function addChecklistItem(
  w: Workspace,
  taskId: string,
  text: string
): Workspace {
  const value = text.trim()
  if (!value) throw new Error("A checklist item needs some text.")
  return withChecklist(w, taskId, (list) => [
    ...list,
    { id: id(), text: value, done: false },
  ])
}

export function updateChecklistItem(
  w: Workspace,
  taskId: string,
  itemId: string,
  patch: Partial<Pick<ChecklistItem, "text" | "done">>
): Workspace {
  const task = w.tasks.find((t) => t.id === taskId)
  if (task && !(task.checklist ?? []).some((item) => item.id === itemId))
    throw new Error("Checklist item not found.")
  return withChecklist(w, taskId, (list) =>
    list.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
  )
}

export function removeChecklistItem(
  w: Workspace,
  taskId: string,
  itemId: string
): Workspace {
  return withChecklist(w, taskId, (list) =>
    list.filter((item) => item.id !== itemId)
  )
}

/** The checklist item a 1-based number names, as the terminal prints them. */
export function checklistItem(task: Task, position: string | undefined) {
  const index = Number(position)
  const item = (task.checklist ?? [])[index - 1]
  if (!Number.isInteger(index) || !item)
    throw new Error(
      `Name an item by its number (1–${(task.checklist ?? []).length || 1}). \`check list ${task.id.slice(0, 8)}\` shows them.`
    )
  return item
}

export function checklistText(task: Task) {
  const list = task.checklist ?? []
  if (!list.length)
    return `No checklist yet. Try check add ${task.id.slice(0, 8)} "First step".`
  const percent = Math.round(taskProgress(task) * 100)
  return [
    `${task.title}  ${bar(percent, 12)} ${percent}%`,
    ...list.map(
      (item, i) =>
        `  ${String(i + 1).padStart(2)}. [${item.done ? "x" : " "}] ${item.text}`
    ),
  ].join("\n")
}

// ---- Column colors ---------------------------------------------------------

/** Sets the color of a column's completion bar; `undefined` resets it. */
export function setColumnColor(
  w: Workspace,
  column: string,
  color: string | undefined
): Workspace {
  if (!w.columns.includes(column)) throw new Error("Column not found.")
  if (color !== undefined && !isHex(color))
    throw new Error("Use a hex color such as #ff8800, or reset.")
  const colors = { ...(w.columnColors ?? {}) }
  if (color === undefined) delete colors[column]
  else colors[column] = color.toLowerCase()
  return { ...w, columnColors: colors }
}

// ---- Nodes -----------------------------------------------------------------

/** Finds a node by exact name, full ID or unique ID prefix. */
export function findNode(w: Workspace, ref: string | undefined) {
  const nodes = w.nodes ?? []
  const key = (ref ?? "").trim()
  const named = nodes.filter((n) => n.name.toLowerCase() === key.toLowerCase())
  if (named.length === 1) return named[0]
  const matches = nodes.filter((n) => key && n.id.startsWith(key))
  if (matches.length !== 1)
    throw new Error("Name a node by its name or ID. `node list` shows them.")
  return matches[0]
}

const existing = (w: Workspace, columns: string[]) => {
  const missing = columns.find((column) => !w.columns.includes(column))
  if (missing !== undefined) throw new Error(`Column not found: ${missing}.`)
  return w.columns.filter((column) => columns.includes(column))
}

export function addNode(
  w: Workspace,
  name: string,
  columns: string[] = []
): Workspace {
  const value = name.trim()
  if (!value) throw new Error("A node needs a name.")
  if ((w.nodes ?? []).some((n) => n.name.toLowerCase() === value.toLowerCase()))
    throw new Error("A node with that name already exists.")
  return {
    ...w,
    nodes: [
      ...(w.nodes ?? []),
      { id: id(), name: value, columns: existing(w, columns) },
    ],
  }
}

export function updateNode(
  w: Workspace,
  nodeId: string,
  patch: Partial<Omit<ProgressNode, "id">>
): Workspace {
  const node = (w.nodes ?? []).find((n) => n.id === nodeId)
  if (!node) throw new Error("Node not found.")
  const next = { ...node }
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error("A node needs a name.")
    if (
      (w.nodes ?? []).some(
        (n) => n.id !== nodeId && n.name.toLowerCase() === name.toLowerCase()
      )
    )
      throw new Error("A node with that name already exists.")
    next.name = name
  }
  if (patch.columns !== undefined) next.columns = existing(w, patch.columns)
  if ("color" in patch) {
    if (patch.color === undefined) delete next.color
    else if (!isHex(patch.color))
      throw new Error("Use a hex color such as #ff8800, or reset.")
    else next.color = patch.color.toLowerCase()
  }
  return {
    ...w,
    nodes: (w.nodes ?? []).map((n) => (n.id === nodeId ? next : n)),
  }
}

/** Connects a node to a column, or disconnects it. */
export function connectNode(
  w: Workspace,
  nodeId: string,
  column: string,
  connected = true
): Workspace {
  const node = (w.nodes ?? []).find((n) => n.id === nodeId)
  if (!node) throw new Error("Node not found.")
  if (!w.columns.includes(column)) throw new Error("Column not found.")
  if (node.columns.includes(column) === connected) return w
  return updateNode(w, nodeId, {
    columns: connected
      ? [...node.columns, column]
      : node.columns.filter((c) => c !== column),
  })
}

export function deleteNode(w: Workspace, nodeId: string): Workspace {
  if (!(w.nodes ?? []).some((n) => n.id === nodeId))
    throw new Error("Node not found.")
  return { ...w, nodes: (w.nodes ?? []).filter((n) => n.id !== nodeId) }
}

/** Keeps bar colors and node connections pointing at a renamed column. */
export function renameColumnRefs(
  w: Workspace,
  from: string,
  to: string
): Workspace {
  const colors = { ...(w.columnColors ?? {}) }
  if (from in colors) {
    colors[to] = colors[from]
    delete colors[from]
  }
  return {
    ...w,
    columnColors: colors,
    nodes: (w.nodes ?? []).map((n) => ({
      ...n,
      columns: n.columns.map((c) => (c === from ? to : c)),
    })),
  }
}

/** Drops a deleted column's bar color and node connections. */
export function dropColumnRefs(w: Workspace, column: string): Workspace {
  const colors = { ...(w.columnColors ?? {}) }
  delete colors[column]
  return {
    ...w,
    columnColors: colors,
    nodes: (w.nodes ?? []).map((n) => ({
      ...n,
      columns: n.columns.filter((c) => c !== column),
    })),
  }
}

/** Every column's bar with each ticket's own percentage, then the nodes. */
export function progressText(w: Workspace) {
  const width = Math.max(...w.columns.map((c) => c.length), 6)
  const lines = w.columns.flatMap((column) => {
    const p = columnProgress(w, column)
    return [
      `${column.padEnd(width)}  ${bar(p.percent)} ${String(p.percent).padStart(3)}%  ${p.done}/${p.total} done`,
      ...p.tasks.map(
        (t) =>
          `  ${String(Math.round(t.progress * 100)).padStart(3)}%  ${t.id.slice(0, 8)}  ${t.title}`
      ),
    ]
  })
  const nodes = (w.nodes ?? []).map((node) => {
    const p = nodeProgress(w, node)
    const columns = nodeColumns(w, node)
    return `${node.id.slice(0, 8)}  ${node.name}  ${bar(p.percent)} ${p.percent}%  ${p.done}/${p.total} done  ← ${columns.join(" + ") || "no columns"}`
  })
  return [...lines, ...(nodes.length ? ["", "NODES", ...nodes] : [])].join("\n")
}
