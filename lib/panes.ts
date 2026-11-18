// The workspace's tiling layout: a tree of panes. A leaf shows one view (or
// nothing yet, while it asks what to open); a split holds two children side
// by side or stacked, with a ratio for the divider between them. Every change
// returns a new tree, so the layout can live in React state and be tested here.
//
// Naming follows vim and tmux: a *vertical* split draws a vertical divider
// (panes side by side), a *horizontal* split draws a horizontal one (stacked).

export type Leaf<V extends string = string> = {
  type: "leaf"
  id: string
  /** null: an empty pane asking what to open. */
  view: V | null
}
export type Split<V extends string = string> = {
  type: "split"
  id: string
  /** "row": children side by side. "column": children stacked. */
  direction: "row" | "column"
  /** Share of the space the first child takes, 0–1. */
  ratio: number
  a: Pane<V>
  b: Pane<V>
}
export type Pane<V extends string = string> = Leaf<V> | Split<V>
/** Where something is dropped on a pane: an edge splits it, the centre replaces it. */
export type Zone = "left" | "right" | "top" | "bottom" | "center"

export const MIN_RATIO = 0.15
export const MAX_RATIO = 0.85
const clamp = (ratio: number) =>
  Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))

let counter = 0
/** A fresh pane id. Ids only need to be unique within one layout. */
export const paneId = () =>
  `p${Date.now().toString(36)}${(counter++).toString(36)}`

export const leaf = <V extends string>(view: V | null, id = paneId()): Leaf<V> => ({
  type: "leaf",
  id,
  view,
})

/** Every leaf, in reading order (left to right, top to bottom). */
export function leaves<V extends string>(pane: Pane<V>): Leaf<V>[] {
  return pane.type === "leaf" ? [pane] : [...leaves(pane.a), ...leaves(pane.b)]
}
export const findLeaf = <V extends string>(pane: Pane<V>, id: string) =>
  leaves(pane).find((item) => item.id === id)
export const findView = <V extends string>(pane: Pane<V>, view: V) =>
  leaves(pane).find((item) => item.view === view)
/** The empty pane, if one is open. There is never more than one. */
export const findBlank = <V extends string>(pane: Pane<V>) =>
  leaves(pane).find((item) => item.view === null)

function map<V extends string>(
  pane: Pane<V>,
  fn: (leaf: Leaf<V>) => Pane<V>
): Pane<V> {
  if (pane.type === "leaf") return fn(pane)
  const a = map(pane.a, fn)
  const b = map(pane.b, fn)
  return a === pane.a && b === pane.b ? pane : { ...pane, a, b }
}

/** Shows `view` in the pane `id`. */
export function setView<V extends string>(
  pane: Pane<V>,
  id: string,
  view: V | null
): Pane<V> {
  return map(pane, (item) =>
    item.id === id && item.view !== view ? { ...item, view } : item
  )
}

/**
 * Splits the pane `id` in two and puts `added` on the given side of it.
 * Left and right make a vertical split, top and bottom a horizontal one.
 */
export function splitPane<V extends string>(
  pane: Pane<V>,
  id: string,
  side: Exclude<Zone, "center">,
  added: Leaf<V>
): Pane<V> {
  return map(pane, (item) => {
    if (item.id !== id) return item
    const first = side === "left" || side === "top"
    return {
      type: "split",
      id: paneId(),
      direction: side === "left" || side === "right" ? "row" : "column",
      ratio: 0.5,
      a: first ? added : item,
      b: first ? item : added,
    }
  })
}

/**
 * Removes the pane `id`; its neighbour takes the freed space. The last pane
 * cannot be closed, so the tree is returned unchanged for it.
 */
export function closePane<V extends string>(pane: Pane<V>, id: string): Pane<V> {
  if (pane.type === "leaf") return pane
  if (pane.a.type === "leaf" && pane.a.id === id) return pane.b
  if (pane.b.type === "leaf" && pane.b.id === id) return pane.a
  const a = closePane(pane.a, id)
  const b = closePane(pane.b, id)
  return a === pane.a && b === pane.b ? pane : { ...pane, a, b }
}

/** Keeps only the pane `id`. */
export function onlyPane<V extends string>(pane: Pane<V>, id: string): Pane<V> {
  return findLeaf(pane, id) ?? pane
}

/** Moves the divider of the split `id`. */
export function resizeSplit<V extends string>(
  pane: Pane<V>,
  id: string,
  ratio: number
): Pane<V> {
  if (pane.type === "leaf") return pane
  if (pane.id === id) {
    const next = clamp(ratio)
    return next === pane.ratio ? pane : { ...pane, ratio: next }
  }
  const a = resizeSplit(pane.a, id, ratio)
  const b = resizeSplit(pane.b, id, ratio)
  return a === pane.a && b === pane.b ? pane : { ...pane, a, b }
}

/**
 * Puts `view` on the pane `target`: on an edge it gets a new pane there, in
 * the centre it replaces what the pane shows. A view is only ever shown once,
 * so if it is already open elsewhere it moves. Returns the layout and the id
 * of the pane now showing the view.
 */
export function placeView<V extends string>(
  pane: Pane<V>,
  view: V,
  target: string,
  zone: Zone
): { layout: Pane<V>; id: string } {
  const current = findView(pane, view)
  // Dropping a pane on itself changes nothing.
  if (current?.id === target) return { layout: pane, id: target }
  if (!findLeaf(pane, target)) return { layout: pane, id: current?.id ?? target }
  let layout = current ? closePane(pane, current.id) : pane
  if (zone === "center") {
    return { layout: setView(layout, target, view), id: target }
  }
  const added = leaf<V>(view)
  layout = splitPane(layout, target, zone, added)
  return { layout, id: added.id }
}

/** The zone of a pane a pointer is over: its nearest edge, or the centre. */
export function zoneAt(
  x: number,
  y: number,
  width: number,
  height: number,
  edge = 0.28
): Zone {
  const fx = width > 0 ? x / width : 0.5
  const fy = height > 0 ? y / height : 0.5
  const distances: [Zone, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ]
  const [zone, distance] = distances.reduce((best, item) =>
    item[1] < best[1] ? item : best
  )
  return distance <= edge ? zone : "center"
}

/** The pane after (or before) `id`, wrapping around: what F6 moves to. */
export function nextLeaf<V extends string>(
  pane: Pane<V>,
  id: string,
  delta = 1
): Leaf<V> {
  const all = leaves(pane)
  const index = Math.max(
    0,
    all.findIndex((item) => item.id === id)
  )
  return all[(index + delta + all.length) % all.length]
}

/**
 * Checks a layout read back from storage: the right shape, known views, and
 * no view or id twice. Anything else is thrown away for the default.
 */
export function isLayout<V extends string>(
  value: unknown,
  views: readonly V[]
): value is Pane<V> {
  const ids = new Set<string>()
  const seen = new Set<string>()
  const valid = (node: unknown, depth: number): boolean => {
    if (typeof node !== "object" || node === null || depth > 8) return false
    const item = node as Record<string, unknown>
    if (typeof item.id !== "string" || ids.has(item.id)) return false
    ids.add(item.id)
    if (item.type === "leaf") {
      if (item.view === null) return true
      if (!views.includes(item.view as V) || seen.has(item.view as string))
        return false
      seen.add(item.view as string)
      return true
    }
    return (
      item.type === "split" &&
      (item.direction === "row" || item.direction === "column") &&
      typeof item.ratio === "number" &&
      item.ratio >= MIN_RATIO &&
      item.ratio <= MAX_RATIO &&
      valid(item.a, depth + 1) &&
      valid(item.b, depth + 1)
    )
  }
  return valid(value, 0)
}
