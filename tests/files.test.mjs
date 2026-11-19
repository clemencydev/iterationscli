import test from "node:test"
import assert from "node:assert/strict"
import {
  addTask,
  addWhiteboardObject,
  deleteTask,
  execute,
  initialWorkspace,
  resolveView,
} from "../lib/alpha.ts"
import {
  addFile,
  addFolder,
  addProject,
  addProjectFile,
  annotatedName,
  deleteFolder,
  ensureTicketFolder,
  ensureVideoFolder,
  fileKind,
  fileProject,
  fileTasks,
  filterFiles,
  findFolder,
  folderPath,
  formatBytes,
  isTexFile,
  isTexSource,
  projectFiles,
  saveAnnotatedCopy,
  texProjects,
  textMime,
  ticketFiles,
  tieFile,
  updateFile,
  updateFolder,
  usedBlobs,
} from "../lib/files.ts"

const run = (w, ...commands) =>
  commands.reduce((current, command) => execute(current, command).workspace, w)
const file = (name, mime, extra = {}) => ({
  name,
  mime,
  size: 2048,
  blob: `blob-${name}`,
  ...extra,
})
/** A workspace with a ticket, two folders (one nested) and three files. */
function sample() {
  let w = addTask(initialWorkspace(), "Launch video")
  const design = addFolder(w, "Design", { color: "#FF8800" })
  const icons = addFolder(design.workspace, "Icons", { parent: design.id })
  w = icons.workspace
  w = addFile(w, file("logo.png", "image/png", { folder: icons.id, width: 400, height: 200 })).workspace
  w = addFile(w, file("teaser.mp4", "video/mp4", { folder: design.id })).workspace
  w = addFile(w, file("notes.md", "")).workspace
  return { w, design: design.id, icons: icons.id }
}

test("files are recognised by type, then by name", () => {
  assert.equal(fileKind("image/png"), "image")
  assert.equal(fileKind("", "clip.MOV"), "video")
  assert.equal(fileKind("application/octet-stream", "song.mp3"), "audio")
  assert.equal(fileKind("", "notes.md"), "text")
  assert.equal(fileKind("application/pdf"), "pdf")
  assert.equal(fileKind("application/zip", "archive.zip"), "other")
  assert.equal(formatBytes(1536), "1.5 KB")
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB")
  assert.equal(formatBytes(0), "0 B")
})

test("folders nest, take a color and refuse duplicates and cycles", () => {
  const { w, design, icons } = sample()
  assert.equal(w.folders[0].color, "#ff8800")
  assert.equal(folderPath(w, icons), "Design / Icons")
  assert.throws(() => addFolder(w, "design"), /already exists/)
  assert.throws(() => addFolder(w, "X", { color: "blue" }), /hex color/)
  assert.throws(() => updateFolder(w, design, { parent: icons }), /into itself/)
  assert.equal(findFolder(w, "Design/Icons").id, icons)
  assert.equal(findFolder(w, icons.slice(0, 8)).id, icons)
  const cleared = updateFolder(w, design, { color: undefined })
  assert.equal("color" in cleared.folders[0], false)
})

test("deleting a folder moves what was in it up a level", () => {
  const { w, design, icons } = sample()
  const next = deleteFolder(w, icons)
  assert.equal(next.folders.length, 1)
  assert.equal(next.files.find((f) => f.name === "logo.png").folder, design)
  const top = deleteFolder(next, design)
  assert.ok(top.files.every((f) => f.folder === undefined))
})

test("the filter finds files in every folder by name, folder or kind", () => {
  const { w } = sample()
  const names = (filter) => filterFiles(w, filter).map((f) => f.name)
  assert.deepEqual(names({ query: "logo" }), ["logo.png"])
  assert.deepEqual(names({ query: "icons" }), ["logo.png"])
  assert.deepEqual(names({ query: "design" }), ["logo.png", "teaser.mp4"])
  assert.deepEqual(names({ kind: "video" }), ["teaser.mp4"])
  assert.deepEqual(names({ query: "design", kind: "image" }), ["logo.png"])
  assert.deepEqual(names({ query: "nothing" }), [])
  assert.equal(names({}).length, 3)
  assert.match(execute(w, 'files "teaser"').output, /teaser\.mp4.*in Design/)
  assert.match(execute(w, "files").output, /Design\/\s+#ff8800\n\s+\w{8} {2}Icons\//)
})

test("a ticket's folder is made on demand, and ties gather its files", () => {
  const { w: start } = sample()
  const task = start.tasks[0]
  const made = ensureTicketFolder(start, task.id)
  assert.equal(ensureTicketFolder(made.workspace, task.id).id, made.id)
  let w = addFile(made.workspace, file("brief.pdf", "application/pdf", { folder: made.id })).workspace
  const teaser = w.files.find((f) => f.name === "teaser.mp4")
  w = tieFile(w, teaser.id, task.id)
  assert.deepEqual(
    ticketFiles(w, task.id).map((f) => f.name).sort(),
    ["brief.pdf", "teaser.mp4"]
  )
  // The folder is called what the ticket is called.
  w = execute(w, `task rename ${task.id} "Launch film"`).workspace
  assert.equal(folderPath(w, made.id), "Launch film")
  w = tieFile(w, teaser.id, task.id, false)
  assert.deepEqual(fileTasks(w, w.files.find((f) => f.id === teaser.id)), [])
  // Deleting the ticket keeps the folder and its files.
  w = deleteTask(w, task.id)
  assert.equal(w.folders.find((f) => f.id === made.id).taskId, undefined)
  assert.equal(w.files.filter((f) => f.folder === made.id).length, 1)
})

test("names stay unique inside a folder", () => {
  const { w, design } = sample()
  const again = addFile(w, file("teaser.mp4", "video/mp4", { folder: design }))
  assert.equal(again.workspace.files.at(-1).name, "teaser (2).mp4")
  const moved = updateFile(again.workspace, again.id, { name: "notes.md", folder: undefined })
  assert.equal(moved.files.at(-1).name, "notes (2).md")
  assert.throws(() => updateFile(w, w.files[0].id, { name: " " }), /needs a name/)
})

test("saving an annotation makes a copy that goes where the original is", () => {
  const { w: start, icons } = sample()
  const task = start.tasks[0]
  const logo = start.files.find((f) => f.name === "logo.png")
  let w = tieFile(start, logo.id, task.id)
  w = addWhiteboardObject(w, "file")
  w = { ...w, objects: w.objects.map((o) => ({ ...o, fileId: logo.id })) }
  const annotation = { pins: [{ id: "p", at: [0.5, 0.5], text: "Too small" }] }
  const saved = saveAnnotatedCopy(w, logo.id, annotation)
  const copy = saved.workspace.files.find((f) => f.id === saved.id)
  assert.equal(copy.name, "logo (annotated).png")
  assert.equal(copy.copyOf, logo.id)
  assert.equal(copy.folder, icons)
  assert.equal(copy.blob, logo.blob)
  assert.deepEqual(copy.taskIds, [task.id])
  assert.deepEqual(copy.annotation, annotation)
  // The original is untouched, and the copy sits beside it on the canvas.
  assert.equal(saved.workspace.files.find((f) => f.id === logo.id).annotation, undefined)
  const placed = saved.workspace.objects.filter((o) => o.kind === "file")
  assert.deepEqual(placed.map((o) => o.fileId), [logo.id, copy.id])
  assert.ok(placed[1].x > placed[0].x + placed[0].width)
  const alone = saveAnnotatedCopy(w, logo.id, annotation, { tie: false })
  assert.equal(alone.workspace.files.at(-1).taskIds, undefined)
  assert.equal(alone.workspace.objects.length, w.objects.length)
  assert.equal(annotatedName("clip (annotated).mp4"), "clip (annotated).mp4")
  assert.equal(annotatedName("README"), "README (annotated)")
  assert.equal(usedBlobs(saved.workspace).size, 3)
})

test("folder and file commands work from the terminal", () => {
  let { w } = sample()
  const task = w.tasks[0]
  const logo = w.files.find((f) => f.name === "logo.png").id.slice(0, 8)
  w = run(w, 'folder new "Exports" #00ff00', 'folder new "Final" "Exports"')
  assert.equal(folderPath(w, w.folders.at(-1).id), "Exports / Final")
  w = run(w, 'folder color "Exports" #112233', `file move ${logo} "Exports/Final"`)
  assert.equal(w.folders.find((f) => f.name === "Exports").color, "#112233")
  assert.equal(w.files.find((f) => f.name === "logo.png").folder, w.folders.at(-1).id)
  w = run(w, `folder ticket "Exports" ${task.id}`, `file tie notes.md ${task.id.slice(0, 8)}`)
  assert.deepEqual(
    ticketFiles(w, task.id).map((f) => f.name).sort(),
    ["logo.png", "notes.md"]
  )
  w = run(w, 'folder ticket "Launch video" none', `file move ${logo} /`, 'folder delete "Exports"')
  assert.equal(w.files.find((f) => f.name === "logo.png").folder, undefined)
  assert.equal(execute(w, `file open ${logo}`).file, w.files.find((f) => f.name === "logo.png").id)
  w = run(w, `file rename ${logo} "mark.png"`, "file delete teaser.mp4")
  assert.deepEqual(w.files.map((f) => f.name).sort(), ["mark.png", "notes.md"])
  assert.throws(() => execute(w, "file open nope"), /by its ID or name/)
  assert.throws(() => execute(w, 'folder color "Nope" #000000'), /name or ID/)
})

test("files can be placed on the canvas and the new views are reachable", () => {
  const { w } = sample()
  const logo = w.files.find((f) => f.name === "logo.png")
  const result = execute(w, `wb add file ${logo.id.slice(0, 8)}`)
  assert.equal(result.view, "canvas")
  assert.equal(result.workspace.objects.at(-1).fileId, logo.id)
  assert.match(execute(result.workspace, "wb list").output, /file: logo\.png/)
  assert.equal(execute(w, "cd files").go, "files")
  assert.equal(execute(w, "tab annotate").view, "annotate")
  assert.equal(resolveView("explorer"), "files")
  assert.equal(resolveView("annotations"), "annotate")
})

test("a LaTeX document is a folder, and its files have paths inside it", () => {
  const text = (path) => ({ path, mime: "text/x-tex", size: 10, blob: `b-${path}` })
  let w = addTask(initialWorkspace(), "Thesis")
  const made = addProject(w, "Thesis", [
    text("main.tex"),
    text("chapters/intro.tex"),
    text("chapters/methods.tex"),
    { path: "figures/plot.png", mime: "image/png", size: 99, blob: "b-plot" },
  ])
  w = made.workspace
  assert.deepEqual(
    projectFiles(w, made.folder).map((f) => f.path),
    ["chapters/intro.tex", "chapters/methods.tex", "figures/plot.png", "main.tex"]
  )
  assert.equal(folderPath(w, w.files.find((f) => f.name === "intro.tex").folder), "Thesis / chapters")
  // The folder of chapters is part of the document, not a document itself.
  assert.deepEqual(texProjects(w), [{ folder: made.folder, name: "Thesis" }])
  assert.equal(fileProject(w, made.ids["chapters/intro.tex"]), made.folder)
  assert.equal(fileProject(w, made.ids["figures/plot.png"]), made.folder)
  // A second document of the same name gets its own folder.
  const again = addProject(w, "Thesis", [text("main.tex")])
  assert.equal(folderPath(again.workspace, again.folder), "Thesis 2")
  // Adding by path reuses folders that exist and refuses a taken path.
  const added = addProjectFile(w, made.folder, "chapters/results.tex", text("x"))
  assert.equal(added.workspace.folders.length, w.folders.length)
  assert.throws(() => addProjectFile(w, made.folder, "chapters/intro.tex", text("x")), /already exists/)
  assert.throws(() => addProjectFile(w, made.folder, "../escape.tex", text("x")), /inside the document/)
  assert.throws(() => addProject(w, " ", []), /needs a name/)
})

test("loose .tex files at the top level are a document of their own", () => {
  let w = initialWorkspace()
  assert.deepEqual(texProjects(w), [])
  w = addFile(w, file("notes.tex", "text/x-tex")).workspace
  w = addFile(w, file("photo.png", "image/png")).workspace
  assert.deepEqual(texProjects(w), [{ folder: undefined, name: "Loose files" }])
  assert.deepEqual(projectFiles(w, undefined).map((f) => f.path), ["notes.tex", "photo.png"])
  assert.equal(fileProject(w, w.files[0].id), undefined)
  assert.ok(isTexFile("Main.TEX") && !isTexFile("refs.bib"))
  assert.ok(isTexSource("refs.bib") && isTexSource("my.cls") && !isTexSource("plot.png"))
  assert.equal(textMime("refs.bib"), "text/x-bibtex")
  assert.equal(textMime("main.tex"), "text/x-tex")
})

test("tex commands list templates, ask for a document and open one", () => {
  let w = initialWorkspace()
  assert.match(execute(w, "tex templates").output, /resume-classic\s+Classic resume/)
  assert.match(execute(w, "tex list").output, /No LaTeX documents yet/)
  const asked = execute(w, 'tex new "My resume" resume-classic')
  assert.deepEqual(asked.latex, { create: { name: "My resume", template: "resume-classic" } })
  assert.equal(asked.workspace, w)
  assert.equal(execute(w, 'tex new "Paper"').latex.create.template, "article")
  assert.throws(() => execute(w, 'tex new "X" nope'), /No template called nope/)
  assert.throws(() => execute(w, "tex new"), /tex new "Name"/)
  const made = addProject(w, "Paper", [
    { path: "main.tex", mime: "text/x-tex", size: 1, blob: "a" },
    { path: "refs.bib", mime: "text/x-bibtex", size: 1, blob: "b" },
    { path: "fig.png", mime: "image/png", size: 1, blob: "c" },
  ])
  w = made.workspace
  const listed = execute(w, "tex list").output
  assert.match(listed, /Paper\/\n {2}\w{8} {2}main\.tex\n {2}\w{8} {2}refs\.bib$/)
  assert.deepEqual(execute(w, 'tex open "Paper"').latex, { open: { folder: made.folder } })
  assert.deepEqual(execute(w, `tex open ${made.ids["refs.bib"].slice(0, 8)}`).latex, {
    open: { folder: made.folder, file: made.ids["refs.bib"] },
  })
  assert.throws(() => execute(w, "tex open fig.png"), /not a text file LaTeX reads/)
  assert.equal(execute(w, "cd latex").go, "latex")
  assert.equal(resolveView("tex"), "latex")
})

test("the terminal opens the explorer and a saved video shares its original clip folder", () => {
  const { w } = sample()
  assert.equal(execute(w, "explorer").explorer, true)
  assert.equal(execute(w, "files").explorer, true)
  assert.equal(execute(w, "files teaser").explorer, undefined)
  const video = w.files.find((f) => f.name === "teaser.mp4")
  const existing = addFolder(w, "teaser.mp4 clips", { parent: video.folder })
  const holder = ensureVideoFolder(existing.workspace, video.id)
  const folder = holder.workspace.folders.find((f) => f.id === holder.id)
  assert.equal(folder.parent, video.folder)
  assert.equal(folder.name, "teaser.mp4 clips (2)")
  const copy = saveAnnotatedCopy(holder.workspace, video.id, {
    sources: [{ name: "intro.mp4", duration: 5, blob: "intro" }],
  })
  assert.equal(ensureVideoFolder(copy.workspace, copy.id).id, holder.id)
  assert.ok(usedBlobs(copy.workspace).has("intro"))
})
