import {
  checkpoint,
  drawingGroups,
  groupStrokes,
  linkObjectToTask,
  nameGroup,
  resolveArrow,
  ungroup,
  type Workspace,
  type Stroke,
  type WhiteboardObject,
} from "./alpha.ts"
export type Box = { x: number; y: number; width: number; height: number }
export type CanvasSelection = { objects: string[]; strokes: string[] }
export const emptySelection = (): CanvasSelection => ({
  objects: [],
  strokes: [],
})
export function boxBetween(a: [number, number], b: [number, number]): Box {
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    width: Math.abs(a[0] - b[0]),
    height: Math.abs(a[1] - b[1]),
  }
}
export function strokeBox(s: Stroke): Box {
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const p of s.points) {
    x = Math.min(x, p[0])
    y = Math.min(y, p[1])
    right = Math.max(right, p[0])
    bottom = Math.max(bottom, p[1])
  }
  return { x, y, width: right - x, height: bottom - y }
}
export function objectBox(
  o: WhiteboardObject,
  objects: WhiteboardObject[]
): Box {
  const r = resolveArrow(o, objects)
  return boxBetween([r.x, r.y], [r.x + r.width, r.y + r.height])
}
const intersects = (a: Box, b: Box) =>
  a.x <= b.x + b.width &&
  a.x + a.width >= b.x &&
  a.y <= b.y + b.height &&
  a.y + a.height >= b.y
export function selectInBox(
  objects: WhiteboardObject[],
  strokes: Stroke[],
  box: Box
): CanvasSelection {
  return {
    objects: objects
      .filter((o) => intersects(objectBox(o, objects), box))
      .map((o) => o.id),
    strokes: strokes
      .filter((s) => s.points.length && intersects(strokeBox(s), box))
      .map((s) => s.id),
  }
}
export function selectionBox(
  objects: WhiteboardObject[],
  strokes: Stroke[],
  selected: CanvasSelection
): Box | null {
  const boxes = [
    ...objects
      .filter((o) => selected.objects.includes(o.id))
      .map((o) => objectBox(o, objects)),
    ...strokes
      .filter((s) => selected.strokes.includes(s.id) && s.points.length)
      .map(strokeBox),
  ]
  if (!boxes.length) return null
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  }
}
export function strokeHit(
  s: Stroke,
  point: [number, number],
  radius: number
): boolean {
  const distance = (a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = dx * dx + dy * dy
    const t = length
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length
          )
        )
      : 0
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)
  }
  return s.points.some(
    (p, i) =>
      distance(p, s.points[Math.max(0, i - 1)]) <= radius + (s.width ?? 3) / 2
  )
}
export function moveItems(
  objects: WhiteboardObject[],
  strokes: Stroke[],
  selected: CanvasSelection,
  dx: number,
  dy: number
) {
  const moving = new Set(
    objects
      .filter((o) => selected.objects.includes(o.id) && !o.locked)
      .map((o) => o.id)
  )
  return {
    objects: objects.map((o) => {
      if (!moving.has(o.id)) return o
      const r = resolveArrow(o, objects)
      return {
        ...r,
        x: r.x + dx,
        y: r.y + dy,
        from: o.from && moving.has(o.from.objectId) ? o.from : undefined,
        to: o.to && moving.has(o.to.objectId) ? o.to : undefined,
      }
    }),
    strokes: strokes.map((s) =>
      selected.strokes.includes(s.id)
        ? {
            ...s,
            points: s.points.map(([x, y]): [number, number] => [
              x + dx,
              y + dy,
            ]),
          }
        : s
    ),
  }
}
export type SelectionAction =
  | { type: "move"; dx: number; dy: number }
  | { type: "delete" }
  | { type: "comment"; text: string }
  | { type: "assign"; taskId?: string; column?: string }
  /** Make one named drawing of the selected strokes (or rename the one they are). */
  | { type: "group"; name: string }
  | { type: "ungroup" }

/** A selection grown to whole drawings: picking one stroke picks its group. */
export function withGroups(
  strokes: Stroke[],
  selected: CanvasSelection
): CanvasSelection {
  const groups = new Set(
    strokes
      .filter((s) => s.group && selected.strokes.includes(s.id))
      .map((s) => s.group)
  )
  if (!groups.size) return selected
  const ids = strokes
    .filter((s) => selected.strokes.includes(s.id) || groups.has(s.group))
    .map((s) => s.id)
  return ids.length === selected.strokes.length
    ? selected
    : { ...selected, strokes: ids }
}
/** The one drawing a selection of strokes is exactly, if it is. */
export function selectedGroup(w: Workspace, selected: CanvasSelection) {
  return drawingGroups(w).find(
    (g) =>
      g.strokes.length === selected.strokes.length &&
      g.strokes.every((s) => selected.strokes.includes(s.id))
  )
}
export function applySelection(
  w: Workspace,
  selected: CanvasSelection,
  action: SelectionAction
): Workspace {
  if (action.type === "group") {
    const existing = selectedGroup(w, selected)
    if (existing)
      return nameGroup(w, existing.id, action.name || existing.name)
    return groupStrokes(w, selected.strokes, action.name).workspace
  }
  if (action.type === "ungroup") {
    const existing = selectedGroup(w, selected)
    if (!existing) throw new Error("Select one whole drawing to ungroup.")
    return ungroup(w, existing.id)
  }
  if (action.type === "assign") {
    if (action.taskId && !w.tasks.some((t) => t.id === action.taskId))
      throw new Error("Task not found.")
    if (action.column && !w.columns.includes(action.column))
      throw new Error("Column not found.")
  }
  if (action.type === "comment" && !action.text.trim())
    throw new Error("Enter a comment.")
  const saved = checkpoint(w, `Before canvas ${action.type}`)
  if (action.type === "move")
    return {
      ...saved,
      ...moveItems(w.objects, w.strokes, selected, action.dx, action.dy),
    }
  if (action.type === "delete") {
    const removed = new Set(
      w.objects
        .filter((o) => selected.objects.includes(o.id) && !o.locked)
        .map((o) => o.id)
    )
    return {
      ...saved,
      strokes: w.strokes.filter((s) => !selected.strokes.includes(s.id)),
      objects: w.objects
        .filter((o) => !removed.has(o.id))
        .map((o) =>
          o.kind === "arrow"
            ? {
                ...resolveArrow(o, w.objects),
                from:
                  o.from && !removed.has(o.from.objectId) ? o.from : undefined,
                to: o.to && !removed.has(o.to.objectId) ? o.to : undefined,
              }
            : o
        ),
    }
  }
  const patch = <T extends Stroke | WhiteboardObject>(item: T): T =>
    action.type === "comment"
      ? { ...item, comments: [...(item.comments ?? []), action.text.trim()] }
      : {
          ...item,
          ...("taskId" in action ? { taskId: action.taskId } : {}),
          ...("column" in action ? { column: action.column } : {}),
        }
  let next: Workspace = {
    ...saved,
    objects: w.objects.map((o) =>
      selected.objects.includes(o.id) ? patch(o) : o
    ),
    strokes: w.strokes.map((s) =>
      selected.strokes.includes(s.id) ? patch(s) : s
    ),
  }
  // Several strokes linked to a ticket together are one drawing: the ticket
  // lists it once, under one ID, instead of once per stroke.
  if (
    action.type === "assign" &&
    action.taskId &&
    selected.strokes.length > 1 &&
    !selectedGroup(next, selected)
  )
    next = groupStrokes(next, selected.strokes).workspace
  if (action.type === "assign" && "taskId" in action) {
    const obsolete = new Set(
      next.objects
        .filter(
          (o) => o.generatedFor && selected.objects.includes(o.generatedFor)
        )
        .map((o) => o.id)
    )
    next = {
      ...next,
      objects: next.objects.filter(
        (o) =>
          !obsolete.has(o.id) &&
          !(
            o.kind === "arrow" &&
            ((o.from && obsolete.has(o.from.objectId)) ||
              (o.to && obsolete.has(o.to.objectId)))
          )
      ),
    }
    if (action.taskId)
      for (const source of next.objects.filter(
        (o) =>
          selected.objects.includes(o.id) &&
          o.kind !== "link" &&
          o.kind !== "arrow"
      )) {
        const linked = linkObjectToTask(next, source.id, action.taskId)
        const node = linked.objects[next.objects.length]
        next = {
          ...linked,
          objects: linked.objects.map((o) =>
            o.id === node.id ? { ...o, generatedFor: source.id } : o
          ),
        }
      }
  }
  return next
}

export type Direction = "left" | "right" | "up" | "down"
/**
 * The item an arrow key moves the selection to: the nearest one whose centre
 * lies in that direction, favouring those straight ahead. With nothing
 * selected yet, the item closest to `origin` (the middle of the view).
 * Returns undefined when there is nowhere to go.
 */
export function neighbour(
  objects: WhiteboardObject[],
  current: string | undefined,
  direction: Direction,
  origin = { x: 0, y: 0 }
): string | undefined {
  const centre = (o: WhiteboardObject) => {
    const box = objectBox(o, objects)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const from = objects.find((o) => o.id === current)
  if (!from) {
    let best: string | undefined
    let nearest = Infinity
    for (const o of objects) {
      const c = centre(o)
      const d = Math.hypot(c.x - origin.x, c.y - origin.y)
      if (d < nearest) {
        nearest = d
        best = o.id
      }
    }
    return best
  }
  const here = centre(from)
  const horizontal = direction === "left" || direction === "right"
  const sign = direction === "left" || direction === "up" ? -1 : 1
  let best: string | undefined
  let lowest = Infinity
  for (const o of objects) {
    if (o.id === from.id) continue
    const c = centre(o)
    const ahead = (horizontal ? c.x - here.x : c.y - here.y) * sign
    const aside = Math.abs(horizontal ? c.y - here.y : c.x - here.x)
    // Behind, or further to the side than ahead: not "in that direction".
    if (ahead <= 0 || aside > ahead * 2) continue
    const score = ahead + aside * 2
    if (score < lowest) {
      lowest = score
      best = o.id
    }
  }
  return best
}
