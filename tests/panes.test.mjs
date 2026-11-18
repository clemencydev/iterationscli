import test from "node:test"
import assert from "node:assert/strict"
import {
  closePane,
  findBlank,
  findView,
  isLayout,
  leaf,
  leaves,
  nextLeaf,
  onlyPane,
  placeView,
  resizeSplit,
  setView,
  splitPane,
  zoneAt,
} from "../lib/panes.ts"
import { execute, initialWorkspace, resolveView } from "../lib/alpha.ts"

const VIEWS = ["terminal", "board", "canvas", "stats"]
const views = (layout) => leaves(layout).map((pane) => pane.view)
const start = () => leaf("terminal", "main")

test("splitting puts the new pane on the side asked for", () => {
  const right = splitPane(start(), "main", "right", leaf("board", "b"))
  assert.equal(right.direction, "row")
  assert.deepEqual(views(right), ["terminal", "board"])
  const left = splitPane(start(), "main", "left", leaf("board", "b"))
  assert.deepEqual(views(left), ["board", "terminal"])
  const below = splitPane(start(), "main", "bottom", leaf("board", "b"))
  assert.equal(below.direction, "column")
  assert.deepEqual(views(below), ["terminal", "board"])
  // Splitting a pane inside a split nests.
  const nested = splitPane(right, "b", "top", leaf("canvas", "c"))
  assert.deepEqual(views(nested), ["terminal", "canvas", "board"])
  assert.equal(nested.b.direction, "column")
})

test("closing a pane gives its space to the neighbour; the last pane stays", () => {
  const two = splitPane(start(), "main", "right", leaf("board", "b"))
  const three = splitPane(two, "b", "bottom", leaf("canvas", "c"))
  assert.deepEqual(views(closePane(three, "b")), ["terminal", "canvas"])
  assert.deepEqual(closePane(two, "b"), start())
  assert.deepEqual(closePane(start(), "main"), start())
  assert.equal(closePane(two, "nope"), two)
  assert.deepEqual(views(onlyPane(three, "c")), ["canvas"])
})

test("dividers move within limits and leave the rest of the tree alone", () => {
  const two = splitPane(start(), "main", "right", leaf("board", "b"))
  assert.equal(resizeSplit(two, two.id, 0.7).ratio, 0.7)
  assert.equal(resizeSplit(two, two.id, 0.01).ratio, 0.15)
  assert.equal(resizeSplit(two, two.id, 2).ratio, 0.85)
  assert.equal(resizeSplit(two, "nope", 0.7), two)
  assert.equal(resizeSplit(two, two.id, 0.5), two)
})

test("a view is only ever shown once: placing it again moves it", () => {
  let layout = start()
  let placed = placeView(layout, "board", "main", "right")
  layout = placed.layout
  assert.deepEqual(views(layout), ["terminal", "board"])
  assert.equal(findView(layout, "board").id, placed.id)
  // Dropped on the far side of the terminal, the board moves there.
  placed = placeView(layout, "board", "main", "left")
  assert.deepEqual(views(placed.layout), ["board", "terminal"])
  // Dropped in the middle of a pane, a view replaces what it shows.
  placed = placeView(layout, "canvas", "main", "center")
  assert.deepEqual(views(placed.layout), ["canvas", "board"])
  assert.equal(placed.id, "main")
  // Dropping a pane on itself changes nothing.
  assert.equal(placeView(layout, "terminal", "main", "bottom").layout, layout)
})

test("an empty pane asks what to open, then shows it", () => {
  const asked = splitPane(start(), "main", "right", leaf(null, "new"))
  assert.equal(findBlank(asked).id, "new")
  const chosen = setView(asked, "new", "stats")
  assert.deepEqual(views(chosen), ["terminal", "stats"])
  assert.equal(findBlank(chosen), undefined)
})

test("a drop lands on the nearest edge, or the centre", () => {
  assert.equal(zoneAt(10, 300, 800, 600), "left")
  assert.equal(zoneAt(790, 300, 800, 600), "right")
  assert.equal(zoneAt(400, 10, 800, 600), "top")
  assert.equal(zoneAt(400, 590, 800, 600), "bottom")
  assert.equal(zoneAt(400, 300, 800, 600), "center")
})

test("F6 walks the panes in reading order and wraps", () => {
  const two = splitPane(start(), "main", "right", leaf("board", "b"))
  const three = splitPane(two, "b", "bottom", leaf("canvas", "c"))
  assert.equal(nextLeaf(three, "main").id, "b")
  assert.equal(nextLeaf(three, "c").id, "main")
  assert.equal(nextLeaf(three, "main", -1).id, "c")
})

test("a saved layout is only restored when it is sound", () => {
  const two = splitPane(start(), "main", "right", leaf("board", "b"))
  assert.ok(isLayout(JSON.parse(JSON.stringify(two)), VIEWS))
  assert.ok(!isLayout(null, VIEWS))
  assert.ok(!isLayout({ type: "leaf", id: "x", view: "nonsense" }, VIEWS))
  // The same view twice, or a divider out of range, is rejected.
  assert.ok(!isLayout(splitPane(start(), "main", "right", leaf("terminal", "t")), VIEWS))
  assert.ok(!isLayout({ ...two, ratio: 0.99 }, VIEWS))
  assert.ok(!isLayout({ ...two, direction: "diagonal" }, VIEWS))
})

test("vsplit, hsplit, close and only describe layout changes; views have nicknames", () => {
  const w = initialWorkspace()
  assert.deepEqual(execute(w, "vsplit board").pane, { op: "split", direction: "row", view: "board" })
  assert.deepEqual(execute(w, "hsplit whiteboard").pane, { op: "split", direction: "column", view: "canvas" })
  // No view: an empty pane that asks.
  assert.deepEqual(execute(w, "vsplit").pane, { op: "split", direction: "row", view: null })
  // `split` is the older name for vsplit.
  assert.deepEqual(execute(w, "split statistics").pane, { op: "split", direction: "row", view: "stats" })
  assert.deepEqual(execute(w, "split off").pane, { op: "only" })
  assert.deepEqual(execute(w, "close incoming").pane, { op: "close", view: "inbox" })
  assert.deepEqual(execute(w, "only").pane, { op: "only" })
  assert.throws(() => execute(w, "vsplit nowhere"), /no such view: nowhere/)
  assert.throws(() => execute(w, "close"), /close <view>/)
  assert.equal(resolveView("Customize"), "settings")
  assert.equal(resolveView("notes"), "canvas")
  assert.equal(resolveView("board"), "board")
  assert.equal(resolveView("xyz"), undefined)
  assert.equal(execute(w, "cd statistics").go, "stats")
})
