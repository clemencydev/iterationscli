import test from "node:test"
import assert from "node:assert/strict"
import { initialWorkspace, execute, revert } from "../lib/alpha.ts"

test("deleting a task is recoverable including its labels and comments", () => {
  let w = execute(initialWorkspace(), 'task new "Review"').workspace
  w.tasks[0].comments = ["Keep context"]
  const id = w.tasks[0].id
  w = execute(w, `task delete ${id.slice(0, 8)}`).workspace
  assert.equal(w.tasks.length, 0)
  w = revert(w, w.commits[0].id)
  assert.equal(w.tasks[0].id, id)
  assert.deepEqual(w.tasks[0].comments, ["Keep context"])
})
test("deleting a populated column preserves tasks and can be restored", () => {
  let w = execute(initialWorkspace(), 'task new "Keep me"').workspace
  w = execute(w, 'column delete "Backlog"').workspace
  assert.deepEqual(w.columns, ["In progress", "Done"])
  assert.equal(w.tasks[0].column, "In progress")
  w = revert(w, w.commits[0].id)
  assert.equal(w.tasks[0].column, "Backlog")
})
test("invalid deletion and deletion of the final column do not mutate data", () => {
  const w = initialWorkspace()
  assert.throws(() => execute(w, "task delete missing"))
  assert.throws(() => execute(w, 'column delete "Missing"'))
  w.columns = ["Only"]
  assert.throws(() => execute(w, "column delete Only"), /at least one/)
  assert.equal(w.commits.length, 0)
  assert.deepEqual(w.columns, ["Only"])
})
