import test from "node:test"
import assert from "node:assert/strict"
import {
  boardNeighbour,
  describeObject,
  drawingGroups,
  execute,
  groupStrokes,
  initialWorkspace,
  lineEnds,
  linkItems,
  linkSymbol,
  normalizeWorkspace,
  ticketCanvasItems,
  unlinkItems,
} from "../lib/alpha.ts"
import {
  applySelection,
  neighbour,
  selectedGroup,
  withGroups,
} from "../lib/canvas-selection.ts"

function canvas() {
  let w = initialWorkspace()
  w = execute(w, 'wb add sticky "Idea"', { x: 0, y: 0 }).workspace
  w = execute(w, 'wb add sticky "Plan"', { x: 600, y: 0 }).workspace
  w = execute(w, 'wb add text "Ship"', { x: 0, y: 500 }).workspace
  const [a, b, c] = w.objects
  return { w, a, b, c, id: (o) => o.id.slice(0, 8) }
}
const stroke = (id, x = 0) => ({
  id,
  color: "#ffffff",
  points: [
    [x, 0],
    [x + 10, 10],
  ],
})

test("link connects two items by ID, directed unless told otherwise", () => {
  const { w, a, b, c, id } = canvas()
  let out = execute(w, `link ${id(a)} ${id(b)}`)
  let arrow = out.workspace.objects.at(-1)
  assert.equal(arrow.kind, "arrow")
  assert.equal(arrow.from.objectId, a.id)
  assert.equal(arrow.to.objectId, b.id)
  assert.deepEqual(lineEnds(arrow), { start: "none", end: "arrow" })
  assert.equal(out.output, `${id(a)} --> ${id(b)}`)
  // Styles by name or by symbol, with an optional label.
  out = execute(w, `link ${id(a)} ${id(c)} undirected "depends on"`)
  arrow = out.workspace.objects.at(-1)
  assert.deepEqual(arrow.ends, { start: "none", end: "none" })
  assert.equal(arrow.text, "depends on")
  assert.deepEqual(execute(w, `link ${id(a)} ${id(b)} <->`).workspace.objects.at(-1).ends, {
    start: "arrow",
    end: "arrow",
  })
  assert.deepEqual(execute(w, `link ${id(a)} ${id(b)} reverse`).workspace.objects.at(-1).ends, {
    start: "arrow",
    end: "none",
  })
  // A word that is not a style is the label.
  assert.equal(execute(w, `link ${id(a)} ${id(b)} blocks`).workspace.objects.at(-1).text, "blocks")
  assert.throws(() => execute(w, `link ${id(a)} ${id(a)}`), /two different items/)
  assert.throws(() => execute(w, `link ${id(a)}`), /by its ID/)
  assert.throws(() => execute(w, "link zzzz yyyy"), /unambiguous ID/)
})

test("arrows made before line ends existed stay directed", () => {
  assert.deepEqual(lineEnds({}), { start: "none", end: "arrow" })
  assert.equal(linkSymbol({ start: "none", end: "arrow" }), "-->")
  assert.equal(linkSymbol({ start: "none", end: "none" }), "--")
  assert.equal(linkSymbol({ start: "arrow", end: "arrow" }), "<-->")
  assert.equal(linkSymbol({ start: "dot", end: "diamond" }), "o--<>")
})

test("ends restyles an arrow; unlink removes the connection either way round", () => {
  const { w, a, b, id } = canvas()
  let next = linkItems(w, a.id, b.id)
  const arrow = next.objects.at(-1)
  next = execute(next, `ends ${id(arrow)} dot diamond`).workspace
  assert.deepEqual(next.objects.at(-1).ends, { start: "dot", end: "diamond" })
  next = execute(next, `ends ${id(arrow)} both`).workspace
  assert.deepEqual(next.objects.at(-1).ends, { start: "arrow", end: "arrow" })
  assert.throws(() => execute(next, `ends ${id(arrow)} wavy`), /none\|arrow\|dot\|diamond/)
  // An item is not an arrow.
  assert.throws(() => execute(next, `ends ${id(a)} both`), /unambiguous ID/)
  const cut = execute(next, `unlink ${id(b)} ${id(a)}`).workspace
  assert.equal(cut.objects.filter((o) => o.kind === "arrow").length, 0)
  assert.throws(() => unlinkItems(cut, a.id, b.id), /not connected/)
})

test("wb list names every item, arrow and drawing with the ID to type", () => {
  const { w, a, b, id } = canvas()
  let next = linkItems(w, a.id, b.id, { start: "none", end: "none" }, "same idea")
  next = { ...next, strokes: [stroke("s1"), stroke("s2")] }
  const grouped = groupStrokes(next, ["s1", "s2"], "Sketch")
  const out = execute(grouped.workspace, "wb list").output
  assert.match(out, new RegExp(`^${id(a)}  sticky: Idea$`, "m"))
  assert.match(out, new RegExp(`arrow: ${id(a)} -- ${id(b)}  "same idea"`))
  assert.match(out, new RegExp(`^${grouped.id.slice(0, 8)}  drawing: Sketch \\(2 strokes\\)$`, "m"))
  assert.equal(describeObject(a, w), "sticky: Idea")
  assert.match(execute(initialWorkspace(), "wb list").output, /canvas is empty/)
})

test("strokes linked to a ticket together become one named drawing", () => {
  let w = execute(initialWorkspace(), 'task new "Design the logo"').workspace
  const task = w.tasks[0]
  w = { ...w, strokes: [stroke("s1"), stroke("s2", 20), stroke("s3", 40), stroke("loose", 90)] }
  const selected = { objects: [], strokes: ["s1", "s2", "s3"] }
  w = applySelection(w, selected, { type: "assign", taskId: task.id })
  // One entry on the ticket, not three.
  const items = ticketCanvasItems(w, task.id)
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, "drawing")
  const [group] = drawingGroups(w)
  assert.equal(items[0].id, group.id)
  assert.equal(group.strokes.length, 3)
  // It can be named, from the panel or the terminal.
  w = applySelection(w, selected, { type: "group", name: "Logo sketch" })
  assert.equal(drawingGroups(w).length, 1)
  assert.equal(ticketCanvasItems(w, task.id)[0].title, "Logo sketch")
  w = execute(w, `wb name ${group.id.slice(0, 8)} "Logo v2"`).workspace
  assert.equal(drawingGroups(w)[0].name, "Logo v2")
  // Picking one stroke picks the drawing; a loose stroke stays alone.
  assert.deepEqual(withGroups(w.strokes, { objects: [], strokes: ["s2"] }).strokes, ["s1", "s2", "s3"])
  assert.deepEqual(withGroups(w.strokes, { objects: [], strokes: ["loose"] }).strokes, ["loose"])
  assert.equal(selectedGroup(w, selected).id, group.id)
  // Ungrouping leaves the strokes, linked one by one again.
  w = applySelection(w, selected, { type: "ungroup" })
  assert.equal(drawingGroups(w).length, 0)
  assert.equal(ticketCanvasItems(w, task.id).length, 3)
})

test("a single linked stroke is not made into a drawing, and bad saved groups are dropped", () => {
  let w = execute(initialWorkspace(), 'task new "Sketch"').workspace
  w = { ...w, strokes: [stroke("s1")] }
  w = applySelection(w, { objects: [], strokes: ["s1"] }, { type: "assign", taskId: w.tasks[0].id })
  assert.equal(drawingGroups(w).length, 0)
  assert.equal(ticketCanvasItems(w, w.tasks[0].id)[0].title, "Linked drawing")
  assert.deepEqual(normalizeWorkspace({ ...w, groups: [{ id: "g", name: "ok" }, { id: 3 }, null] }).groups, [
    { id: "g", name: "ok" },
  ])
  assert.deepEqual(normalizeWorkspace({ ...w, groups: undefined }).groups, [])
})

test("arrow keys walk the canvas to the nearest item in that direction", () => {
  const { w, a, b, c } = canvas()
  assert.equal(neighbour(w.objects, a.id, "right"), b.id)
  assert.equal(neighbour(w.objects, b.id, "left"), a.id)
  assert.equal(neighbour(w.objects, a.id, "down"), c.id)
  assert.equal(neighbour(w.objects, c.id, "up"), a.id)
  // Nothing further that way: stay put.
  assert.equal(neighbour(w.objects, a.id, "left"), undefined)
  assert.equal(neighbour(w.objects, a.id, "up"), undefined)
  // With nothing selected, start from the item nearest the middle of the view.
  assert.equal(neighbour(w.objects, undefined, "right", { x: 650, y: 20 }), b.id)
  assert.equal(neighbour([], undefined, "right"), undefined)
})

test("arrow keys walk the task board by column and row", () => {
  const columns = ["Todo", "Doing", "Empty", "Done"]
  const tasks = [
    { id: "a", column: "Todo" },
    { id: "b", column: "Todo" },
    { id: "c", column: "Todo" },
    { id: "d", column: "Doing" },
    { id: "e", column: "Done" },
    { id: "f", column: "Done" },
  ]
  assert.equal(boardNeighbour(columns, tasks, undefined, "down"), "a")
  assert.equal(boardNeighbour(columns, tasks, "a", "down"), "b")
  assert.equal(boardNeighbour(columns, tasks, "b", "up"), "a")
  assert.equal(boardNeighbour(columns, tasks, "a", "up"), undefined)
  // Sideways keeps the row where it can, and skips empty columns.
  assert.equal(boardNeighbour(columns, tasks, "c", "right"), "d")
  assert.equal(boardNeighbour(columns, tasks, "d", "right"), "e")
  assert.equal(boardNeighbour(columns, tasks, "f", "left"), "d")
  assert.equal(boardNeighbour(columns, tasks, "e", "right"), undefined)
  assert.equal(boardNeighbour(columns, [], undefined, "down"), undefined)
})
