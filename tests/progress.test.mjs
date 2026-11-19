import test from "node:test"
import assert from "node:assert/strict"
import {
  addTask,
  execute,
  initialWorkspace,
  normalizeWorkspace,
  updateTask,
} from "../lib/alpha.ts"
import {
  addChecklistItem,
  addNode,
  columnProgress,
  connectNode,
  nodeProgress,
  setColumnColor,
  taskProgress,
  updateChecklistItem,
} from "../lib/progress.ts"

const run = (w, ...commands) =>
  commands.reduce((current, command) => execute(current, command).workspace, w)
const board = () =>
  run(initialWorkspace(), 'task new "Plan"', 'task new "Build"', 'task new "Ship"')

test("a ticket's percentage comes from its checklist, and done is always 100%", () => {
  let w = board()
  const id = w.tasks[0].id
  assert.equal(taskProgress(w.tasks[0]), 0)
  w = addChecklistItem(w, id, "Outline")
  w = addChecklistItem(w, id, "Draft")
  w = addChecklistItem(w, id, "Review")
  w = addChecklistItem(w, id, "Publish")
  w = updateChecklistItem(w, id, w.tasks[0].checklist[0].id, { done: true })
  assert.equal(taskProgress(w.tasks[0]), 0.25)
  w = updateTask(w, id, { done: true })
  assert.equal(taskProgress(w.tasks[0]), 1)
  assert.throws(() => addChecklistItem(w, id, "  "), /needs some text/)
  assert.throws(() => addChecklistItem(w, "missing", "x"), /not found/)
})

test("a column's bar averages its tickets, keeping each ticket's own share", () => {
  let w = board()
  const [plan, build] = w.tasks
  w = run(
    w,
    `check add ${plan.id} "One"`,
    `check add ${plan.id} "Two"`,
    `check done ${plan.id} 1`,
    `task done ${build.id}`
  )
  const p = columnProgress(w, "Backlog")
  assert.deepEqual(
    p.tasks.map((t) => t.progress),
    [0.5, 1, 0]
  )
  assert.equal(p.percent, 50)
  assert.equal(p.done, 1)
  assert.equal(p.total, 3)
  assert.equal(columnProgress(w, "Done").percent, 0)
})

test("check commands add, tick, untick and remove steps by number", () => {
  let w = board()
  const id = w.tasks[0].id.slice(0, 8)
  w = run(w, `check add ${id} "First"`, `check add ${id} "Second"`)
  assert.match(execute(w, `check list ${id}`).output, /1\. \[ \] First/)
  w = run(w, `check done ${id} 2`)
  assert.equal(w.tasks[0].checklist[1].done, true)
  assert.match(execute(w, `task show ${id}`).output, /Checklist\s+1\/2/)
  assert.match(execute(w, "board").output, /Plan {2}\(1\/2\)/)
  w = run(w, `check undo ${id} 2`, `check remove ${id} 1`)
  assert.deepEqual(
    w.tasks[0].checklist.map((item) => [item.text, item.done]),
    [["Second", false]]
  )
  assert.throws(() => execute(w, `check done ${id} 9`), /by its number/)
  assert.throws(() => execute(w, `check nope ${id}`), /check list\|add/)
})

test("column bar colors are set from the terminal and follow renames and deletes", () => {
  let w = run(board(), 'column color "Backlog" #FF8800')
  assert.equal(w.columnColors.Backlog, "#ff8800")
  w = run(w, 'column rename "Backlog" "To do"')
  assert.deepEqual(w.columnColors, { "To do": "#ff8800" })
  w = run(w, 'column color "To do" reset')
  assert.deepEqual(w.columnColors, {})
  assert.throws(() => setColumnColor(w, "To do", "orange"), /hex color/)
  assert.throws(() => setColumnColor(w, "Missing", "#000000"), /not found/)
  w = run(w, 'column color "Done" #00ff00', 'column delete "Done"')
  assert.deepEqual(w.columnColors, {})
})

test("a node combines the completion of the columns it is connected to", () => {
  let w = board()
  const [plan, build, ship] = w.tasks
  w = run(
    w,
    `task move ${build.id} "In progress"`,
    `task move ${ship.id} "Done"`,
    `task done ${ship.id}`,
    `check add ${build.id} "Half"`,
    `check add ${build.id} "Other half"`,
    `check done ${build.id} 1`,
    'node new "Release" "In progress" "Done"'
  )
  const node = w.nodes[0]
  assert.deepEqual(node.columns, ["In progress", "Done"])
  // Build is half done, Ship is done: (0.5 + 1) / 2.
  assert.equal(nodeProgress(w, node).percent, 75)
  w = run(w, 'node connect "Release" "Backlog"')
  // Plan has not started: (0 + 0.5 + 1) / 3.
  assert.equal(nodeProgress(w, w.nodes[0]).percent, 50)
  assert.equal(nodeProgress(w, w.nodes[0]).total, 3)
  assert.match(execute(w, "node list").output, /Release.*50%.*Backlog \+ In progress \+ Done/)
  assert.match(execute(w, "progress").output, /NODES/)
  w = run(w, 'node disconnect "Release" "Backlog"', 'node color "Release" #123456')
  assert.equal(w.nodes[0].color, "#123456")
  assert.deepEqual(w.nodes[0].columns, ["In progress", "Done"])
  assert.equal(plan.column, "Backlog")
})

test("nodes follow column renames, drop deleted columns and reject bad input", () => {
  let w = run(board(), 'node new "All" "Backlog" "Done"')
  w = run(w, 'column rename "Backlog" "Queue"')
  assert.deepEqual(w.nodes[0].columns, ["Queue", "Done"])
  w = run(w, 'column delete "Done"')
  assert.deepEqual(w.nodes[0].columns, ["Queue"])
  assert.throws(() => addNode(w, "all"), /already exists/)
  assert.throws(() => addNode(w, "  "), /needs a name/)
  assert.throws(() => addNode(w, "Other", ["Nope"]), /Column not found: Nope/)
  assert.throws(() => connectNode(w, w.nodes[0].id, "Nope"), /Column not found/)
  assert.equal(connectNode(w, w.nodes[0].id, "Queue"), w)
  w = run(w, `node rename ${w.nodes[0].id.slice(0, 8)} "Everything"`)
  assert.equal(w.nodes[0].name, "Everything")
  w = run(w, 'node delete "Everything"')
  assert.deepEqual(w.nodes, [])
})

test("older workspaces load without the new fields, and stale references are dropped", () => {
  const saved = addTask(initialWorkspace(), "Old")
  delete saved.nodes
  delete saved.columnColors
  delete saved.folders
  delete saved.files
  const w = normalizeWorkspace(saved)
  assert.deepEqual(w.nodes, [])
  assert.deepEqual(w.columnColors, {})
  assert.deepEqual(w.folders, [])
  assert.deepEqual(w.files, [])
  const messy = normalizeWorkspace({
    ...saved,
    columnColors: { Backlog: "#abcdef", Gone: "#000000", Done: "red" },
    nodes: [{ id: "n", name: "N", columns: ["Backlog", "Gone"] }, { id: 1 }],
  })
  assert.deepEqual(messy.columnColors, { Backlog: "#abcdef" })
  assert.deepEqual(messy.nodes, [{ id: "n", name: "N", columns: ["Backlog"] }])
})
