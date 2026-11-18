import test from "node:test"
import assert from "node:assert/strict"
import {
  initialWorkspace,
  addWhiteboardObject,
  addTask,
  connectObjects,
  resolveArrow,
  revert,
} from "../lib/alpha.ts"
import {
  applySelection,
  boxBetween,
  selectInBox,
  strokeHit,
} from "../lib/canvas-selection.ts"

test("marquee supports reverse drags and selects both objects and strokes", () => {
  const w = addWhiteboardObject(initialWorkspace(), "sticky", "A", {
    x: 400,
    y: 400,
  })
  w.strokes = [
    {
      id: "ink",
      color: "#000000",
      points: [
        [350, 350],
        [450, 450],
      ],
    },
  ]
  const selection = selectInBox(
    w.objects,
    w.strokes,
    boxBetween([600, 600], [200, 200])
  )
  assert.deepEqual(selection, { objects: [w.objects[0].id], strokes: ["ink"] })
  assert.deepEqual(
    selectInBox(w.objects, w.strokes, boxBetween([0, 0], [10, 10])),
    { objects: [], strokes: [] }
  )
})
test("eraser hits between sampled stroke points, including thick lines and dots", () => {
  const stroke = {
    id: "s",
    color: "#000000",
    width: 14,
    points: [
      [0, 0],
      [100, 0],
    ],
  }
  assert.equal(strokeHit(stroke, [50, 8], 2), true)
  assert.equal(strokeHit(stroke, [50, 30], 2), false)
  assert.equal(strokeHit({ ...stroke, points: [[20, 20]] }, [21, 21], 2), true)
})
test("group move respects locks and keeps connected items connected", () => {
  let w = addWhiteboardObject(initialWorkspace(), "sticky", "A")
  w = addWhiteboardObject(w, "document", "B")
  const [a, b] = w.objects
  w = connectObjects(
    w,
    { objectId: a.id, side: "right" },
    { objectId: b.id, side: "left" }
  )
  const arrow = w.objects[2]
  const before = resolveArrow(arrow, w.objects)
  w = applySelection(
    w,
    { objects: w.objects.map((o) => o.id), strokes: [] },
    { type: "move", dx: 50, dy: 25 }
  )
  const after = resolveArrow(w.objects[2], w.objects)
  assert.equal(after.x, before.x + 50)
  assert.equal(after.width, before.width)
  assert.equal(w.objects[2].from.objectId, a.id)
  w.objects[0].locked = true
  const x = w.objects[0].x
  w = applySelection(
    w,
    { objects: [a.id], strokes: [] },
    { type: "move", dx: 100, dy: 0 }
  )
  assert.equal(w.objects[0].x, x)
})
test("bulk deletion is recoverable and leaves locked items intact", () => {
  let w = addWhiteboardObject(initialWorkspace(), "sticky", "A")
  w = addWhiteboardObject(w, "kanban")
  w.objects[1].locked = true
  w.strokes = [{ id: "ink", color: "#000000", points: [[0, 0]] }]
  w = applySelection(
    w,
    { objects: w.objects.map((o) => o.id), strokes: ["ink"] },
    { type: "delete" }
  )
  assert.equal(w.objects.length, 1)
  assert.equal(w.strokes.length, 0)
  w = revert(w, w.commits[0].id)
  assert.equal(w.objects.length, 2)
  assert.equal(w.strokes.length, 1)
})
test("selection comments and categories persist for ink and objects", () => {
  let w = addTask(
    addWhiteboardObject(initialWorkspace(), "document"),
    "Write spec"
  )
  w.strokes = [{ id: "ink", color: "#000000", points: [[0, 0]] }]
  const selected = { objects: [w.objects[0].id], strokes: ["ink"] }
  w = applySelection(w, selected, {
    type: "assign",
    taskId: w.tasks[0].id,
    column: "Backlog",
  })
  w = applySelection(w, selected, { type: "comment", text: "Needs review" })
  for (const item of [
    ...w.objects.filter((o) => selected.objects.includes(o.id)),
    ...w.strokes,
  ]) {
    assert.equal(item.column, "Backlog")
    assert.equal(item.taskId, w.tasks[0].id)
    assert.deepEqual(item.comments, ["Needs review"])
  }
  assert.deepEqual(JSON.parse(JSON.stringify(w)).objects[0].comments, [
    "Needs review",
  ])
  assert.throws(() =>
    applySelection(w, selected, { type: "assign", column: "missing" })
  )
})
