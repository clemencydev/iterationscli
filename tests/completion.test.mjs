import test from "node:test"
import assert from "node:assert/strict"
import {
  complete,
  splitInput,
  applyCompletion,
  ghostText,
  tabComplete,
  commonPrefix,
} from "../lib/completion.ts"

const registry = {
  task: {
    name: "task",
    usage: "Manage tasks",
    sub_commands: {
      new: { name: "new", args: [{ name: "title", descriprion: '"title"' }] },
      move: {
        name: "move",
        args: [
          { name: "task-id", descriprion: "<task-id>", source: "task" },
          { name: "column", descriprion: '"Column"', source: "column" },
        ],
      },
    },
  },
  tab: {
    name: "tab",
    args: [{ name: "view", descriprion: "<view>", values: ["board", "canvas"] }],
  },
  theme: { name: "theme", args: [{ name: "theme", descriprion: "<theme>", values: ["amber"] }] },
  help: { name: "help" },
}
const sources = {
  task: [{ value: "1a2b3c4d", description: "Write docs" }, "9f8e7d6c"],
  column: ["Backlog", "In progress", "In review"],
}
const values = (c) => c.candidates.map((x) => x.value)

test("splits finished words from the word being typed, respecting quotes", () => {
  assert.deepEqual(splitInput("task move "), { done: ["task", "move"], start: 10, partial: "" })
  assert.deepEqual(splitInput('task new "My ta'), { done: ["task", "new"], start: 9, partial: "My ta" })
  assert.deepEqual(splitInput(""), { done: [], start: 0, partial: "" })
})

test("completes command names, then subcommands, by prefix", () => {
  assert.deepEqual(values(complete("t", registry)), ["task", "tab", "theme"])
  assert.deepEqual(values(complete("TA", registry)), ["task", "tab"])
  assert.deepEqual(values(complete("task ", registry)), ["new", "move"])
  assert.deepEqual(values(complete("task m", registry)), ["move"])
  assert.equal(complete("task ", registry).candidates[0].description, undefined)
  assert.equal(complete("ta", registry).candidates[0].description, "Manage tasks")
})

test("completes arguments from fixed values and live sources", () => {
  assert.deepEqual(values(complete("tab c", registry)), ["canvas"])
  assert.deepEqual(values(complete("task move ", registry, sources)), ["1a2b3c4d", "9f8e7d6c"])
  assert.deepEqual(values(complete("task move 1a2b3c4d in", registry, sources)), ["In progress", "In review"])
  assert.deepEqual(values(complete('task move 1a2b3c4d "In r', registry, sources)), ["In review"])
})

test("unknown commands and exhausted arguments offer nothing", () => {
  assert.deepEqual(values(complete("nope ", registry)), [])
  assert.deepEqual(values(complete("constructor ", registry)), [])
  assert.deepEqual(values(complete("task toString ", registry)), [])
  assert.deepEqual(values(complete("help extra", registry)), [])
  assert.deepEqual(values(complete("tab board more", registry)), [])
})

test("applying a completion quotes values with spaces and leaves room for the next word", () => {
  const input = "task move 1a2b3c4d in"
  const c = complete(input, registry, sources)
  assert.equal(applyCompletion(input, c, "In progress"), 'task move 1a2b3c4d "In progress" ')
  assert.equal(applyCompletion("ta", complete("ta", registry), "task"), "task ")
})

test("ghost text continues what was typed, or shows the argument placeholder", () => {
  assert.equal(ghostText("the", complete("the", registry)), "me")
  assert.equal(ghostText("task new ", complete("task new ", registry)), '"title"')
  assert.equal(ghostText("", complete("", registry)), "")
  // A value that needs quotes cannot continue an unquoted word; a quoted one can.
  const unquoted = "task move 1a2b3c4d In"
  assert.equal(ghostText(unquoted, complete(unquoted, registry, sources)), "")
  const open = 'task move 1a2b3c4d "In r'
  assert.equal(ghostText(open, complete(open, registry, sources)), 'eview"')
})

test("tab completes a single match, extends a shared prefix, then cycles", () => {
  assert.deepEqual(tabComplete("the", complete("the", registry)), { input: "theme ", index: 0 })
  assert.equal(tabComplete("zzz", complete("zzz", registry)), null)
  assert.equal(commonPrefix([{ value: "task" }, { value: "tab" }]), "ta")
  const c = complete("t", registry)
  assert.deepEqual(tabComplete("t", c), { input: "task", index: 0 })
  assert.deepEqual(tabComplete("t", c, 0), { input: "tab", index: 1 })
  assert.deepEqual(tabComplete("t", c, 2), { input: "task", index: 0 })
  assert.deepEqual(tabComplete("t", c, 0, true), { input: "theme", index: 2 })
  const two = complete("ta", { task: registry.task, tasks: { name: "tasks" } })
  assert.deepEqual(tabComplete("ta", two), { input: "task", index: -1 })
})
