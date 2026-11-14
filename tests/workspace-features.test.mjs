import test from "node:test"
import assert from "node:assert/strict"
import {
  initialWorkspace,
  execute,
  addTask,
  addWhiteboardObject,
  addPaletteColor,
  removePaletteColor,
  renameColumn,
  setLabelColor,
  deleteLabel,
  nearestSide,
  objectAt,
  linkObjectToTask,
  resolveArrow,
  normalizeWorkspace,
  isWorkspace,
  DEFAULT_PALETTE,
} from "../lib/alpha.ts"
import {
  parseGoogleFont,
  familyFromFile,
  fontStack,
  isSavedFont,
  isFontFile,
} from "../lib/font.ts"
import { describeDocument } from "../lib/document.ts"

test("renaming a column keeps its tasks and rejects duplicates and blanks", () => {
  let w = addTask(initialWorkspace(), "Plan")
  w = execute(w, 'column rename "Backlog" "To do"').workspace
  assert.deepEqual(w.columns, ["To do", "In progress", "Done"])
  assert.equal(w.tasks[0].column, "To do")
  assert.throws(() => renameColumn(w, "To do", "Done"), /already exists/)
  assert.throws(() => renameColumn(w, "To do", "   "), /needs a name/)
  assert.throws(() => renameColumn(w, "Missing", "X"), /not found/)
  assert.equal(renameColumn(w, "Done", "Done"), w)
})

test("labels take a color at creation, can be recolored, and detach when deleted", () => {
  let w = addTask(initialWorkspace(), "Sketch")
  w = execute(w, 'label new "Urgent" global #FF5555').workspace
  assert.equal(w.labels[0].color, "#ff5555")
  assert.equal(w.labels[0].scope, "global")
  w = execute(w, 'label color "Urgent" #00aa88').workspace
  assert.equal(w.labels[0].color, "#00aa88")
  assert.throws(() => execute(w, 'label color "Urgent" teal'), /hex color/)
  assert.throws(() => execute(w, 'label color "Nope" #000000'), /Create that label/)
  assert.throws(() => setLabelColor(w, "missing", "#000000"), /not found/)
  w = execute(w, `label add ${w.tasks[0].id} "Urgent"`).workspace
  assert.equal(w.tasks[0].labels.length, 1)
  w = deleteLabel(w, w.labels[0].id)
  assert.deepEqual(w.labels, [])
  assert.deepEqual(w.tasks[0].labels, [])
})

test("the pen palette saves unique colors and removes them", () => {
  let w = initialWorkspace()
  assert.deepEqual(w.palette, DEFAULT_PALETTE)
  w = addPaletteColor(w, "#ABCDEF")
  assert.equal(w.palette.at(-1), "#abcdef")
  assert.equal(addPaletteColor(w, "#abcdef"), w)
  assert.throws(() => addPaletteColor(w, "red"), /hex color/)
  w = removePaletteColor(w, "#ABCDEF")
  assert.deepEqual(w.palette, DEFAULT_PALETTE)
})

test("workspaces saved before the palette existed load with defaults", () => {
  const old = initialWorkspace()
  delete old.palette
  delete old.penWidth
  delete old.objects
  assert.ok(isWorkspace(old))
  const w = normalizeWorkspace(old)
  assert.deepEqual(w.palette, DEFAULT_PALETTE)
  assert.equal(w.penWidth, 3)
  assert.deepEqual(w.objects, [])
  assert.equal(isWorkspace({ schema: 2 }), false)
  assert.equal(isWorkspace(null), false)
})

test("text and ticket-link items can be added from the terminal", () => {
  let w = addTask(initialWorkspace(), "Write docs")
  let result = execute(w, 'wb add text "Hello"')
  assert.equal(result.workspace.objects[0].kind, "text")
  assert.equal(result.workspace.objects[0].text, "Hello")
  result = execute(w, `wb add link ${w.tasks[0].id.slice(0, 8)}`)
  assert.equal(result.view, "canvas")
  assert.equal(result.workspace.objects[0].kind, "link")
  assert.equal(result.workspace.objects[0].taskId, w.tasks[0].id)
  assert.throws(() => execute(w, "wb add link missing"), /unambiguous/)
  assert.equal(execute(w, "wb add link").workspace.objects[0].taskId, undefined)
})

test("stickies start with a color", () => {
  const w = addWhiteboardObject(initialWorkspace(), "sticky")
  assert.match(w.objects[0].color, /^#[\da-f]{6}$/)
})

test("an arrow end dropped on an item attaches to its nearest side", () => {
  let w = addWhiteboardObject(initialWorkspace(), "sticky")
  w = addWhiteboardObject(w, "arrow")
  const sticky = { ...w.objects[0], x: 100, y: 100, width: 200, height: 100 }
  const objects = [sticky, w.objects[1]]
  assert.equal(objectAt(objects, { x: 150, y: 150 }).id, sticky.id)
  assert.equal(objectAt(objects, { x: 95, y: 150 }).id, sticky.id, "within the snap margin")
  assert.equal(objectAt(objects, { x: 50, y: 150 }), undefined)
  assert.equal(objectAt(objects, { x: 150, y: 150 }, sticky.id), undefined, "excluded item")
  assert.equal(nearestSide(sticky, { x: 105, y: 150 }), "left")
  assert.equal(nearestSide(sticky, { x: 290, y: 150 }), "right")
  assert.equal(nearestSide(sticky, { x: 200, y: 90 }), "top")
  assert.equal(nearestSide(sticky, { x: 200, y: 210 }), "bottom")
  // Arrows never accept connections, even when they are on top.
  const arrow = { ...w.objects[1], x: 100, y: 100, width: 200, height: 100 }
  assert.equal(objectAt([sticky, arrow], { x: 150, y: 150 }).id, sticky.id)
})

test("linking an item to a ticket adds a connected link node that follows the item", () => {
  let w = addTask(initialWorkspace(), "Write docs")
  w = addWhiteboardObject(w, "sticky")
  const sticky = w.objects[0]
  w = linkObjectToTask(w, sticky.id, w.tasks[0].id)
  const [, node, arrow] = w.objects
  assert.equal(node.kind, "link")
  assert.equal(node.taskId, w.tasks[0].id)
  assert.equal(arrow.kind, "arrow")
  assert.deepEqual(arrow.from, { objectId: sticky.id, side: "right" })
  assert.deepEqual(arrow.to, { objectId: node.id, side: "left" })
  const moved = w.objects.map((o) => (o.id === sticky.id ? { ...o, x: o.x - 500 } : o))
  assert.equal(resolveArrow(arrow, moved).x, moved[0].x + moved[0].width)
  assert.throws(() => linkObjectToTask(w, "missing"), /not found/)
  assert.throws(() => linkObjectToTask(w, sticky.id, "missing"), /Task not found/)
})

test("Google font input accepts names and Google links only", () => {
  assert.equal(parseGoogleFont("  Fira   Code ").family, "Fira Code")
  assert.equal(
    parseGoogleFont("Fira Code").href,
    "https://fonts.googleapis.com/css?family=Fira+Code:400,500,600,700&display=swap"
  )
  assert.equal(parseGoogleFont("https://fonts.google.com/specimen/IBM+Plex+Mono").family, "IBM Plex Mono")
  assert.equal(
    parseGoogleFont("https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap").family,
    "Space Mono"
  )
  assert.throws(() => parseGoogleFont("https://evil.example/font.css"), /Google Fonts link/)
  assert.throws(() => parseGoogleFont('Fira"; } body { display:none'), /Google Fonts name/)
  assert.throws(() => parseGoogleFont(""), /Google Fonts name/)
})

test("uploaded fonts get a safe family name and saved fonts are validated", () => {
  assert.equal(familyFromFile("My_Font-Regular.woff2"), "My Font Regular")
  assert.equal(familyFromFile("!!!.ttf"), "Custom font")
  assert.ok(isFontFile("a.OTF"))
  assert.equal(isFontFile("a.svg"), false)
  assert.equal(fontStack('Bad"Name').startsWith('"BadName",'), true)
  assert.ok(isSavedFont({ family: "Fira Code", source: "google", href: "https://fonts.googleapis.com/css?family=Fira+Code" }))
  assert.ok(isSavedFont({ family: "Mine", source: "file", data: "data:font/woff2;base64,AAAA" }))
  assert.equal(isSavedFont({ family: "X", source: "google", href: "https://evil.example/x.css" }), false)
  assert.equal(isSavedFont({ family: 'x"y', source: "file", data: "data:," }), false)
  assert.equal(isSavedFont(null), false)
})

test("document summary counts words, characters and reading time", () => {
  assert.deepEqual(describeDocument("  "), { words: 0, characters: 0, minutes: 0 })
  assert.deepEqual(describeDocument(" one  two\nthree "), { words: 3, characters: 14, minutes: 1 })
  assert.equal(describeDocument("word ".repeat(600)).minutes, 3)
})

test("completion series buckets by local day, oldest first, ending today", async () => {
  const { completionSeries, countTicks, dayTicks } = await import("../lib/stats.ts")
  const now = new Date(2026, 10, 14, 15, 0)
  const at = (daysAgo, hour = 10) => new Date(2026, 10, 14 - daysAgo, hour).toISOString()
  const tasks = [
    { done: true, completed: at(0) },
    { done: true, completed: at(0, 1) },
    { done: true, completed: at(3) },
    { done: true, completed: at(40) },
    { done: false, completed: at(1) },
    { done: true },
  ]
  const week = completionSeries(tasks, 7, now)
  assert.deepEqual(week.map((d) => d.count), [0, 0, 0, 1, 0, 0, 2])
  assert.equal(new Date(week.at(-1).date).getDate(), 14)
  assert.equal(completionSeries(tasks, 90, now).reduce((n, d) => n + d.count, 0), 4)
  assert.equal(completionSeries([], 30, now).length, 30)
  assert.deepEqual(countTicks(0), [0, 1])
  assert.deepEqual(countTicks(3), [0, 1, 2, 3])
  assert.deepEqual(countTicks(7), [0, 2, 4, 6, 8])
  assert.deepEqual(countTicks(37), [0, 10, 20, 30, 40])
  assert.deepEqual(dayTicks(7, 10), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(dayTicks(30, 6), [4, 9, 14, 19, 24, 29])
  assert.deepEqual(dayTicks(0, 6), [])
})
