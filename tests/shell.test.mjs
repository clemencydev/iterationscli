import test from "node:test"
import assert from "node:assert/strict"
import {
  banner,
  builtin,
  detectShell,
  editLine,
  entryPrompt,
  highlight,
  promptText,
  remember,
  searchHistory,
  searchPrompt,
  windowTitle,
  workingDirectory,
} from "../lib/shell.ts"
import { execute, initialWorkspace } from "../lib/alpha.ts"

const here = { user: "ada", workspace: "personal", view: "terminal" }
const board = { ...here, view: "board" }
const registry = {
  task: {
    name: "task",
    sub_commands: { new: { name: "new" }, list: { name: "list" } },
  },
  ls: { name: "ls" },
}

test("the shell follows the operating system", () => {
  assert.equal(detectShell("Win32"), "powershell")
  assert.equal(detectShell("Windows"), "powershell")
  assert.equal(detectShell("MacIntel"), "zsh")
  assert.equal(detectShell("iPhone"), "zsh")
  assert.equal(detectShell("Linux x86_64"), "bash")
  assert.equal(detectShell(""), "bash")
})

test("each shell writes its prompt its own way, with the view as the folder", () => {
  assert.equal(promptText("powershell", here), "PS iterations:\\personal> ")
  assert.equal(promptText("powershell", board), "PS iterations:\\personal\\board> ")
  assert.equal(promptText("bash", here), "ada@iterations:~/personal$ ")
  assert.equal(promptText("bash", board), "ada@iterations:~/personal/board$ ")
  assert.equal(promptText("zsh", here), "ada@iterations ~ % ")
  assert.equal(promptText("zsh", board), "ada@iterations board % ")
  assert.equal(entryPrompt("powershell", "guest"), "PS iterations:\\>")
  assert.equal(entryPrompt("bash", "guest"), "guest@iterations:~$")
  assert.equal(workingDirectory("bash", board), "/home/iterations/personal/board")
  assert.equal(workingDirectory("powershell", here), "iterations:\\personal")
  assert.match(windowTitle("powershell", here), /^PowerShell/)
  assert.match(windowTitle("zsh", here), /zsh$/)
})

test("startup text names the shell and counts the work", () => {
  const info = { version: "1.2.3", workspace: "personal", tasks: 1, done: 0, incoming: 2 }
  assert.match(banner("powershell", info), /^Iterations PowerShell 1\.2\.3/)
  assert.match(banner("bash", info), /^Welcome to iterations 1\.2\.3/)
  assert.match(banner("zsh", info), /^Last login: /)
  for (const flavor of ["powershell", "bash", "zsh"])
    assert.match(banner(flavor, info), /1 task, 0 done, 2 incoming/)
})

test("built-ins answer questions about the terminal itself", () => {
  const context = { ...board, flavor: "bash", automatic: true, history: ["ls", "task list"] }
  assert.deepEqual(builtin("exit", context), { exit: true })
  assert.equal(builtin("pwd", context).output, "/home/iterations/personal/board")
  assert.equal(builtin("whoami", context).output, "ada")
  assert.equal(builtin("history", context).output, "  1  ls\n  2  task list")
  assert.equal(builtin("shell zsh", context).shell, "zsh")
  assert.equal(builtin("shell auto", context).shell, "auto")
  assert.match(builtin("shell", context).output, /^bash \(matches this device\)/)
  assert.throws(() => builtin("shell fish", context), /powershell\|bash\|zsh/)
  // Everything else belongs to the workspace.
  assert.equal(builtin("task list", context), null)
  assert.equal(builtin("", context), null)
})

test("line editing cuts and moves by word like readline", () => {
  const line = { value: 'task new "Write docs"', caret: 8 }
  assert.deepEqual(editLine(line, "kill-to-start"), { value: ' "Write docs"', caret: 0 })
  assert.deepEqual(editLine(line, "kill-to-end"), { value: "task new", caret: 8 })
  assert.deepEqual(editLine(line, "delete-word-back"), { value: 'task  "Write docs"', caret: 5 })
  assert.deepEqual(editLine({ value: "task new", caret: 4 }, "delete-word-forward"), { value: "task", caret: 4 })
  assert.equal(editLine(line, "word-back").caret, 5)
  assert.equal(editLine(line, "word-forward").caret, 15)
  assert.equal(editLine(line, "start").caret, 0)
  assert.equal(editLine(line, "end").caret, line.value.length)
  assert.deepEqual(editLine({ value: "", caret: 0 }, "delete-word-back"), { value: "", caret: 0 })
})

test("history skips blanks and immediate repeats, and stays bounded", () => {
  let history = []
  for (const line of ["ls", "ls", "  ", "task list", "ls"]) history = remember(history, line)
  assert.deepEqual(history, ["ls", "task list", "ls"])
  assert.deepEqual(remember(["a", "b", "c"], "d", 3), ["b", "c", "d"])
})

test("Ctrl+R finds the newest match, then steps to older ones", () => {
  const history = ['task new "A"', "column new Review", "stats", 'task new "B"']
  const first = searchHistory(history, "NEW")
  assert.equal(first, 3)
  const second = searchHistory(history, "new", first)
  assert.equal(second, 1)
  assert.equal(searchHistory(history, "new", second), 0)
  assert.equal(searchHistory(history, "new", 0), -1)
  assert.equal(searchHistory(history, "zzz"), -1)
  assert.equal(searchHistory(history, ""), -1)
  assert.equal(searchPrompt("bash", "new", true), "(reverse-i-search)`new': ")
  assert.equal(searchPrompt("bash", "zzz", false), "(failed reverse-i-search)`zzz': ")
  assert.match(searchPrompt("zsh", "new", true), /^bck-i-search: new/)
})

test("syntax colouring tells commands, subcommands, strings and typos apart", () => {
  const kinds = (input) =>
    highlight(input, registry)
      .filter((token) => token.kind !== "space")
      .map((token) => `${token.kind}:${token.text}`)
  assert.deepEqual(kinds('task new "Write docs" now'), [
    "command:task",
    "subcommand:new",
    'string:"Write docs"',
    "argument:now",
  ])
  assert.deepEqual(kinds("tsak new"), ["unknown:tsak", "argument:new"])
  assert.deepEqual(kinds("LS"), ["command:LS"])
  // An unfinished quote is still a string, and nothing is lost.
  const line = 'task  new "half'
  assert.equal(highlight(line, registry).map((token) => token.text).join(""), line)
  assert.equal(highlight(line, registry).at(-1).kind, "string")
  assert.deepEqual(highlight("", registry), [])
})

// ---- The workspace commands the terminal adds ----

function seeded() {
  let w = initialWorkspace()
  w = execute(w, 'task new "Write the launch post"').workspace
  w = execute(w, 'task new "Fix login redirect"').workspace
  return w
}

test("the board prints as text, column by column", () => {
  const w = seeded()
  const id = w.tasks[0].id.slice(0, 8)
  const done = execute(w, `task done ${id}`).workspace
  const out = execute(done, "board").output
  assert.match(out, new RegExp(`^${w.columns[0]} \\(2\\)\\n  ${id}  \\[x\\] Write the launch post`))
  assert.match(out, /\(empty\)/)
  // ls and dir are the same listing.
  assert.equal(execute(done, "ls").output, out)
  assert.equal(execute(done, "dir").output, out)
})

test("tickets can be read, renamed, commented on and opened without the mouse", () => {
  let w = seeded()
  const id = w.tasks[1].id.slice(0, 8)
  w = execute(w, `task rename ${id} "Fix the login redirect"`).workspace
  w = execute(w, `task comment ${id} "Happens on Safari"`).workspace
  assert.equal(w.tasks[1].title, "Fix the login redirect")
  assert.deepEqual(w.tasks[1].comments, ["Happens on Safari"])
  const shown = execute(w, `task show ${id}`).output
  assert.match(shown, new RegExp(`^${id}  Fix the login redirect`))
  assert.match(shown, /Status\s+open/)
  assert.match(shown, /1\. Happens on Safari/)
  const opened = execute(w, `task open ${id}`)
  assert.equal(opened.ticket, w.tasks[1].id)
  assert.equal(opened.workspace, w)
  assert.throws(() => execute(w, `task rename ${id}`), /New title/)
  assert.throws(() => execute(w, `task comment ${id}`), /Text/)
})

test("find, stats, log, inbox and the lists report without changing anything", () => {
  let w = seeded()
  assert.match(execute(w, "find LOGIN").output, /Fix login redirect/)
  assert.doesNotMatch(execute(w, "find login").output, /launch/)
  assert.match(execute(w, "find nothing-here").output, /^No task matches/)
  assert.throws(() => execute(w, "find"), /find "text"/)
  assert.match(execute(w, "stats").output, /^2 tasks · 0 done \(0%\)/)
  assert.match(execute(w, "log").output, /No restore points yet/)
  w = execute(w, 'checkpoint "before cleanup"').workspace
  assert.match(execute(w, "log").output, /^[\da-f]{8}  \d{4}-\d\d-\d\d \d\d:\d\d  before cleanup$/m)
  assert.equal(execute(w, "inbox").output, "Nothing incoming.")
  assert.match(execute(w, "column list").output, new RegExp(`^${w.columns[0]} \\(2\\)`))
  assert.match(execute(w, "label list").output, /No labels yet/)
  w = execute(w, "label new urgent global #ff5555").workspace
  assert.match(execute(w, "label list").output, /^urgent\s+global\s+#ff5555$/)
  for (const command of ["stats", "log", "inbox", "column list", "label list", "board", "find a"])
    assert.equal(execute(w, command).workspace, w)
})

test("cd walks between views and home, like directories", () => {
  const w = initialWorkspace()
  assert.equal(execute(w, "cd board").go, "board")
  for (const home of ["cd", "cd ~", "cd ..", "cd /"])
    assert.equal(execute(w, home).go, "terminal")
  assert.equal(execute(w, "cd board").output, "")
  assert.throws(() => execute(w, "cd nowhere"), /no such view: nowhere/)
  // cls and man are the names other shells use.
  assert.equal(execute(w, "cls").clear, true)
  assert.equal(execute(w, "man").output, execute(w, "help").output)
})
