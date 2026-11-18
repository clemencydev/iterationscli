import test from "node:test"
import assert from "node:assert/strict"
import {
  initialWorkspace,
  addWhiteboardObject,
  addTask,
  linkObjectToTask,
  ticketCanvasItems,
  resolveArrow,
} from "../lib/alpha.ts"
import { applySelection } from "../lib/canvas-selection.ts"

test("ticket backlink follows a manually connected shortcut and updates when retargeted", () => {
  let w = addTask(
    addTask(addWhiteboardObject(initialWorkspace(), "sticky", "Idea"), "First"),
    "Second"
  )
  const source = w.objects[0].id
  w = linkObjectToTask(w, source, w.tasks[0].id)
  const link = w.objects.find((o) => o.kind === "link")
  assert.ok(ticketCanvasItems(w, w.tasks[0].id).some((o) => o.id === source))
  link.taskId = w.tasks[1].id
  assert.equal(ticketCanvasItems(w, w.tasks[0].id).length, 0)
  assert.ok(ticketCanvasItems(w, w.tasks[1].id).some((o) => o.id === source))
  w.objects = w.objects.filter((o) => o.id !== source)
  assert.ok(!ticketCanvasItems(w, w.tasks[1].id).some((o) => o.id === source))
})

test("selection linking adds movable visual shortcut without duplicates and clears it on unlink", () => {
  let w = addTask(
    addWhiteboardObject(initialWorkspace(), "document", "Spec"),
    "Write spec"
  )
  const source = w.objects[0].id,
    selected = { objects: [source], strokes: [] },
    taskId = w.tasks[0].id
  w = applySelection(w, selected, { type: "assign", taskId })
  w = applySelection(w, selected, { type: "assign", taskId })
  assert.equal(w.objects.filter((o) => o.kind === "link").length, 1)
  const link = w.objects.find((o) => o.kind === "link"),
    arrow = w.objects.find((o) => o.kind === "arrow")
  link.x += 100
  const geometry = resolveArrow(arrow, w.objects)
  assert.equal(geometry.x + geometry.width, link.x)
  assert.equal(
    ticketCanvasItems(w, taskId).filter((o) => o.id === source).length,
    1
  )
  w = applySelection(w, selected, { type: "assign", taskId: undefined })
  assert.equal(ticketCanvasItems(w, taskId).length, 0)
  assert.equal(w.objects.length, 1)
})
