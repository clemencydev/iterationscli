import test from "node:test"
import assert from "node:assert/strict"
import {
  initialWorkspace,
  execute,
  addTask,
  updateTask,
  checkpoint,
  revert,
  parseProposals,
  mergeProposal,
} from "../lib/alpha.ts"

test("commands create and move the same tasks that the board edits", () => {
  let w = execute(
    initialWorkspace(),
    'task new "Design the homepage"'
  ).workspace
  const id = w.tasks[0].id
  w = execute(w, `task move ${id.slice(0, 8)} "In progress"`).workspace
  assert.equal(w.tasks[0].title, "Design the homepage")
  assert.equal(w.tasks[0].column, "In progress")
  assert.equal(w.tasks[0].done, false)
  assert.throws(() => execute(w, "task done missing"), /unambiguous/)
})

test("completion and submission remain separate, with stable completion dates", () => {
  let w = addTask(initialWorkspace(), "Send the proposal")
  const id = w.tasks[0].id
  w = updateTask(w, id, { submission: "pending", done: true })
  const completed = w.tasks[0].completed
  w = updateTask(w, id, { title: "Send the final proposal" })
  assert.equal(w.tasks[0].completed, completed)
  assert.equal(w.tasks[0].submission, "pending")
  w = updateTask(w, id, { done: false })
  assert.equal(w.tasks[0].completed, undefined)
  w = updateTask(w, id, { submission: "submitted" })
  assert.equal(w.tasks[0].done, true)
  assert.ok(w.tasks[0].completed)
})

test("global and local labels attach without duplicates", () => {
  let w = addTask(initialWorkspace(), "Sketch")
  w = execute(w, 'label new "Design work" global').workspace
  w = execute(w, 'label new "Draft" local').workspace
  const cmd = `label add ${w.tasks[0].id} "Design work"`
  w = execute(execute(w, cmd).workspace, cmd).workspace
  assert.equal(w.tasks[0].labels.length, 1)
  assert.deepEqual(
    w.labels.map((l) => l.scope),
    ["global", "local"]
  )
})

test("merge requests are read-only until confirmation and reject duplicate imports", () => {
  let w = initialWorkspace()
  w.proposals = parseProposals(
    '[{"id":"mail-1","title":"Reply","source":"Email"}]',
    w
  )
  const review = execute(w, "merge mail-1")
  assert.equal(review.workspace.tasks.length, 0)
  assert.equal(review.confirm.type, "merge")
  w = mergeProposal(w, "mail-1")
  assert.equal(w.tasks[0].title, "Reply")
  assert.equal(w.commits.length, 2)
  assert.equal(w.proposals.length, 0)
  assert.throws(
    () =>
      parseProposals('[{"id":"mail-1","title":"Reply","source":"Email"}]', w),
    /Duplicate/
  )
})

test("invalid proposal batches do not partly import", () => {
  const w = initialWorkspace()
  assert.throws(
    () =>
      parseProposals(
        '[{"id":"a","title":"A","source":"X"},{"id":"a","title":"B","source":"X"}]',
        w
      ),
    /Duplicate/
  )
  assert.throws(
    () =>
      parseProposals(
        '[{"id":"a","title":"A","source":"X","taskId":"missing"}]',
        w
      ),
    /does not exist/
  )
  assert.throws(
    () =>
      parseProposals('[{"id":"a","title":"A","source":"X","done":"false"}]', w),
    /true or false/
  )
  assert.equal(w.proposals.length, 0)
})

test("merging a completion updates an existing task without duplicating it", () => {
  let w = addTask(initialWorkspace(), "Review PR")
  w.proposals = parseProposals(
    JSON.stringify([
      {
        id: "github-1",
        title: "Review PR",
        source: "GitHub",
        taskId: w.tasks[0].id,
        done: true,
      },
    ]),
    w
  )
  w = mergeProposal(w, "github-1")
  assert.equal(w.tasks.length, 1)
  assert.equal(w.tasks[0].done, true)
  const beforeMerge = w.commits[0].id
  w = revert(w, beforeMerge)
  assert.equal(w.tasks[0].done, false)
  assert.equal(w.commits.length, 4)
  assert.ok(w.merged.includes("github-1"))
})

test("restore preserves current work in history and snapshots do not share references", () => {
  let w = checkpoint(addTask(initialWorkspace(), "Original"), "Start")
  const originalId = w.commits[0].id
  w = updateTask(w, w.tasks[0].id, {
    title: "Changed",
    comments: ["New comment"],
  })
  assert.equal(w.commits[0].snapshot.tasks[0].title, "Original")
  w = revert(w, originalId)
  assert.equal(w.tasks[0].title, "Original")
  assert.equal(w.commits[1].snapshot.tasks[0].title, "Changed")
  assert.equal(w.commits.length, 3)
})

test("empty titles and invalid commands fail without changing state", () => {
  const w = initialWorkspace()
  assert.throws(() => execute(w, 'task new ""'), /title/)
  assert.throws(() => execute(w, "column new Backlog"), /new, nonempty/)
  assert.throws(() => execute(w, "theme missing"), /Unknown/)
  assert.equal(w.tasks.length, 0)
})
