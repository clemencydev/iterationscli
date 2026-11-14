# IterationsCLI · 0.1.0-alpha.1

A task workspace combining a terminal, visual boards, and a drawing canvas. This first alpha is under active rework and testing. It is a personal, browser-local release; it does not connect to external services or provide shared editing yet.

## Run locally

Use Node.js 24 LTS (the test runner loads TypeScript directly).

```sh
npm install
npm run dev
```

Open `http://localhost:3000` for the original front page. Choose **Get Started → workspace** (or press Ctrl+Y and select workspace), or visit `/alpha` directly. The alpha needs no account or database credentials. Existing authentication and dashboard routes remain available separately; they still use their existing backend configuration. The root layout downloads Google fonts at build time.

## Included in alpha 01

- Animated terminal welcome, command reference, and command recall with Up/Down.
- Task creation through commands or forms, editable titles, columns, drag-and-drop movement, comments, completion, and separate submission status.
- Custom colored labels with global/local scope metadata. One workspace and one board are available in this release.
- Task search, label filtering, and a Needs submission filter that retains finished but unsubmitted work.
- View tabs and two-pane splitting, with a draggable resize corner on desktop.
- Persistent freehand canvas, undo stroke, notes, and selected note text converted to tasks with source text recorded in a comment.
- Statistics calculated from actual tasks: totals, completion, seven-day completions, and progress by column.
- The original website's black-and-white light/dark theme, square borders, and monospace typography. Optional phosphor, amber, and violet accents, custom accent colors, scanlines, and reduced-motion support. Choose **Original** in Customize or run `theme original` to return from a saved accent palette.
- Manual JSON proposal imports, source and change previews, Y/N merge confirmation, duplicate detection, and before/after merge checkpoints.
- Named checkpoints with unique IDs. Restoring records the current state before applying the selected snapshot.
- Browser autosave and JSON backup export. Storage failures are shown rather than silently claiming success.

## Try the terminal

```text
task new "Design the landing page"
task list
column new "Review"
label new "Design" global
label add <task-id> "Design"
task move <task-id> "Review"
task done <task-id>
split board
theme amber
checkpoint "First milestone"
wb add sticky "Next big idea"
wb add kanban
wb add arrow "Next step"
wb add document "Project notes"
```

`help` lists supported commands. Use quotes for names containing spaces. Task and checkpoint IDs accept unique prefixes. The terminal interprets application commands only; it does not run PowerShell or arbitrary shell code.

Whiteboard objects also appear in the floating **+ Add** menu. Drag object headers to move them and bottom-right handles to resize them. Edit notes and documents directly; drag either arrow endpoint to extend or redirect it. The kanban object displays the same tasks and columns as the Task board. Objects autosave and are included in checkpoints. **Fit** frames drawings and objects. Scroll the mouse wheel over the canvas to zoom around the pointer; scrolling inside documents or kanban panels scrolls their contents.

## Review and merge

In Incoming, paste a JSON array such as:

```json
[
  {
    "id": "manual-1",
    "title": "Review the homepage",
    "source": "Manual import"
  }
]
```

To update a task, include its full `taskId` and optionally `done: true` or `done: false`. IDs may contain letters, numbers, underscores, dots, and dashes. All proposals require review; clicking Review merge opens the terminal, where Y/N or the confirmation buttons apply or cancel the change. If workspace data changes during review, confirmation is rejected and a fresh review is required.

To undo a merge, restore its **Before merge** checkpoint in History. Checkpoints cover tasks, columns, labels, drawings, and notes. They do not rewind preferences, the incoming queue, or the ledger of already merged proposal IDs. Restore itself creates history, so the previous workspace can be recovered.

## Storage and current limits

Data belongs to this browser profile and origin, under `iterationscli.alpha.v1` in localStorage. Export backups before clearing site data. This is not cloud storage; use one app tab at a time. Browser storage has a size limit, especially with extensive drawings and checkpoints. Export is available, but a guided backup import UI is not implemented yet. Layout and terminal output reset on reload; tasks, drawings, preferences, and history persist.

This alpha does not yet provide real-time collaboration, permission enforcement, media storage/annotations, nested comment threads, mentions, multiple boards, custom command macros, email/GitHub/Codecademy/school connectors, or a Chrome extension. The legacy dashboard's server data is not migrated into the local alpha.

## Next releases

1. Harden the core: backup import, multiple boards, persistent layouts, richer task editing, accessibility and user testing.
2. Add files and videos with anchored annotations and timestamp comments, plus richer canvas-to-task links.
3. Add authenticated cloud persistence, collaborative sessions, inherited item permissions, replies, and mentions.
4. Connect GitHub, permitted browser pages, and email to the review queue, preserving source evidence and conflict resolution.

## Checks

```sh
npm run test:alpha
npm run typecheck
npm run build
```

The alpha tests cover command/board interoperability, labels, submission states, import validation, duplicate prevention, merge review, and recoverable restores.
