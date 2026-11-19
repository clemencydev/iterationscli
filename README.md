# iterationscli

A personal terminal, task board and whiteboard. Next.js 16, React 19, Tailwind 4.

- `/` — marketing page and the entry terminal (Ctrl+Y)
- `/alpha` — the workspace: terminal, task board, canvas, files, annotate, LaTeX, statistics, incoming, history, customize
- `/dashboard` — the signed-in account board

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm test           # node --test "tests/*.test.mjs"
npm run build
```

## Storage

The workspace always saves to the browser (`localStorage`), so it works with no
account and no backend. When Supabase is configured **and** you are signed in,
the same workspace is also mirrored to your account through
`/api/kamako/workspace`, and picked up on other devices. The status bar says
which mode is active.

Imported files are different: only their descriptions (name, folder, ticket,
annotation) live in the workspace. Their contents stay in the browser they were
imported in (IndexedDB, `lib/file-store.ts`), so on another device a file is
listed but has nothing to show. [docs/storage-cost-analysis.md](docs/storage-cost-analysis.md)
compares what it would cost to store them, and the workspace, on Supabase or
on DynamoDB.

## Supabase

Nothing is required to run locally. To turn on accounts and sync:

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor.
2. In Supabase: Project Settings → API → **Exposed schemas** → add `iterations`.
3. Copy `.env.example` to `.env.local` and fill it in (never commit it):

| Variable | Required | What it is |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Project URL, `https://<ref>.supabase.co`. `NEXT_PUBLIC_SUPABASE_URL` is also accepted. |
| `SUPABASE_SERVICE_ROLE_KEY` | recommended | Service role (secret) key. Server only. The schema enables row level security with no policies, so the server routes need this key. `SUPABASE_SECRET_KEY` is also accepted. |
| `SUPABASE_PUBLISHABLE_KEY` | alternative | Publishable / anon key, used when no service role key is set. Then you must also apply the commented-out "Alternative" grants at the bottom of `supabase/schema.sql`. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are also accepted. |
| `JWT_SECRET` | yes | Long random string that signs the sign-in cookie, e.g. `openssl rand -base64 48`. |

Restart the dev server after changing them. Sign up from the entry terminal
(`register`), open `/alpha`, and the status bar switches to "synced to your
account".

All Supabase access happens in server routes (`app/api/auth/*`,
`app/api/kamako/*`) through `lib/supabase/client.ts`; `lib/supabase/env.ts`
decides whether Supabase is configured.

## Site themes

`lib/themes.ts` holds the color schemes a terminal ships with: the ones in
Windows Terminal's defaults (which PowerShell runs in) and Ubuntu's. Choosing
one in Customize, or with `theme <name>` in either terminal (`theme list`
shows them), restyles the whole site: the design tokens in `app/globals.css`
are derived from the scheme's background, foreground and ANSI colors
(`schemeTokens`), the terminal takes the scheme's own colors, and the
landing-page fractal is drawn between its two ends. `theme default` is the
site's own look and sets nothing. The choice is kept per device
(`lib/theme-client.ts`) and applied by a small script in `app/layout.tsx`
before the first paint. `theme phosphor|amber|violet` still changes only the
workspace's accent color.

## Tickets, columns and nodes

- A ticket has a **checklist** (`check add|done|undo|remove`, or in the
  ticket). Its percentage is the share of steps ticked; a completed ticket is
  100%.
- Every column ends in a **completion bar**: one segment per ticket, each
  filled as far as that ticket has come, with the column's average beside it.
  The bar's color is picked beside it or with `column color "Column" #hex`.
- A **progress node** connects to several columns and shows their completion
  combined, every ticket counted once: `node new "Release" "In progress"
  "Done"`, `node connect|disconnect|color|rename|delete`. `progress` prints
  all of it. The arithmetic is in `lib/progress.ts`.

## Files and annotations

- **Files** (`components/alpha/FileExplorer.tsx`, `lib/files.ts`): import any
  file; make folders, nest them, color them (`folder new|color|rename|ticket|
  delete`). Every ticket has a folder of its own, made the first time
  something goes in it, and a file can also be tied to tickets from anywhere
  (`file tie`). The filter looks through every folder at once (`files
  "text"`).
- **Annotate** (`components/alpha/Annotator.tsx`, `lib/annotations.ts`):
  - Images: pen, lines, arrows, boxes, ellipses, text and numbered comments.
  - Video: on-screen text, splits and cut sections on a timeline. Nothing is
    re-encoded; the changes export as a CSV (every change), a CMX 3600 EDL
    (the cuts as a timeline for Premiere Pro, DaVinci Resolve and others) and
    an SRT (the text as captions).
  - Audio: comments at a moment of the recording (work in progress).
  - Everything else: notes, with a preview for text and PDF.
- Saving an annotation leaves the original alone and stores a **copy** beside
  it in Files, tied to the same tickets and placed next to the original on the
  canvas. A video's copy comes with its edits as a `.edits.csv` file.
- A file can be put on the **canvas** (`wb add file <file-id>`, or "Place on
  canvas"); clicking it there opens it in Annotate.

## LaTeX

The LaTeX view (`components/alpha/LatexEditor.tsx`) is an editor in the manner
of Overleaf: source on the left, the typeset PDF on the right, compiled in the
browser. Nothing you write is sent anywhere.

- **A document is a folder in Files**: its main `.tex` file and whatever that
  pulls in (chapters, images, a `.bib`, a `.cls`), referred to by their paths
  inside the folder. Start one from a template (resumes, CV, cover letter,
  letter, article, report, slides, notes), import existing `.tex` files, or
  `tex new "Name" [template]` in the terminal (`tex templates`, `tex list`,
  `tex open`).
- **The compiler** is pdfLaTeX from TeX Live 2026, compiled to WebAssembly (the
  [Siglum](https://github.com/SiglumProject/siglum) engine, MIT; see
  `public/latex/THIRD_PARTY.txt`) and run in a Web Worker by
  `lib/latex-engine.ts`. It runs the extra passes and BibTeX itself. Any
  package in TeX Live works: it is fetched the first time a document loads it
  and kept in the browser. The Packages tab is a searchable catalog that writes
  the `\usepackage` line; the Fonts tab does the same for 19 font choices, each
  checked against this compiler.
- **Editing** (`LatexSource.tsx`, CodeMirror 6): highlighting, completion for
  commands, environments, packages, labels, citation keys and file names,
  Ctrl+Enter or Ctrl+S to compile, and it compiles by itself after a pause in
  typing. What TeX reports is read by `parseLog` in `lib/latex.ts` and shown in
  plain words with the line marked. The preview (`PdfView.tsx`, pdf.js) keeps
  its place across compiles. "Save PDF to Files" puts the PDF beside the
  document, where it can be tied to a ticket or placed on the canvas.
- **Not there**: XeLaTeX and LuaLaTeX (so no fontspec and no font files of
  your own), Biber (use `backend=bibtex` with biblatex), and anything that
  needs shell escape, such as minted.

The engine's runtime is about 50 MB on first use (plus 60 MB of fonts the
first time a document uses T1 Computer Modern without `lmodern`), then cached
by the browser. By default it is downloaded from the engine project's own file
server, as are packages. To serve the runtime from this site instead:

```bash
npm run latex:assets     # ~127 MB into public/latex/releases (git-ignored)
npm run latex:packages   # optional: mirror common packages into public/latex/pkgs
```

The app uses `public/latex/releases` when it is there. For packages, set
`NEXT_PUBLIC_LATEX_PACKAGES=/latex/pkgs` to use the mirror; only mirrored
packages resolve then.

## Fractal background

The marketing page sits on a real Mandelbrot deep zoom
(`components/marketing/Mandelbrot.tsx`, WebGL2). Each reload picks a different
destination from `lib/mandelbrot/presets.ts` and zooms from the whole set down
to a minibrot, as deep as a span of 1e-38. Plain floats give out around 1e-13,
so the centre's orbit is computed with BigInt fixed point
(`lib/mandelbrot/math.ts`) and the shader iterates each pixel as a small
difference from it (perturbation with rebasing).

The destinations are found, not hand-typed:
`node scripts/mandelbrot-presets.mjs` rewrites `presets.ts`
(`--preview <dir>` also writes PNG stills of each zoom).

## Terminal

The workspace terminal (`components/alpha/ShellTerminal.tsx`) is the keyboard
way into the board, tickets, canvas and history. It dresses as the shell of
the visitor's operating system: PowerShell on Windows, zsh on macOS, bash
elsewhere. `shell powershell|bash|zsh|auto` overrides that per device.

- **Commands** act on the workspace, not the machine: `board` (or `ls`),
  `task new|show|open|move|done|rename|comment`, `find`, `cd <view>`, `stats`,
  `log`, `revert`, `inbox`, `merge`. `help` lists them all. They live in
  `execute` in `lib/alpha.ts`; `cd board` keeps the terminal and shows the
  board beside it.
- **Keys**: Tab completes commands, subcommands and arguments (again to
  cycle), → accepts the dimmed suggestion, ↑/↓ recall history (kept across
  reloads), Ctrl+R searches it, Ctrl+L clears, Ctrl+C cancels, Ctrl+U/K cut
  the line, Esc empties it. Ctrl+Y opens the terminal as a window over any
  view and Ctrl+` jumps to the prompt.
- **Where things are**: prompts, startup text, line editing, history search
  and syntax colouring are pure functions in `lib/shell.ts`; completion is
  `lib/completion.ts`, driven by the command registry in
  `contexts/TerminalContext/commands.ts`. A command added to the registry
  completes and colours for free. The landing-page terminal (Ctrl+Y on `/`)
  is the same component.

## Workspace layout and keys

The views are tiled in panes (`lib/panes.ts`, `components/alpha/Panes.tsx`);
each view is on screen at most once, and the layout is remembered per device.

- **Split**: drag a view from the sidebar, a tab or a pane's bar onto a pane.
  An edge splits it that way, the centre replaces it. Or `vsplit [view]`
  (side by side) and `hsplit [view]` (top and bottom) in the terminal, or
  Ctrl+\ and Ctrl+Shift+\ (V and H outside text fields). Without a view the
  new pane asks what to open. `close <view>` and `only` take panes away.
- **Resize**: drag the divider between two panes, or focus it and use the
  arrow keys; double-click evens it out.
- **Move around**: F6 goes to the next pane, X closes the one you are in.
- **Arrow keys select instead of scrolling**: on the task board they walk the
  tickets (Enter opens, Space completes, Shift+←/→ moves a column); on the
  canvas they walk the items and show the selected item's ID.
- **Undo and redo**: Ctrl+Z and Ctrl+Shift+Z anywhere outside a text field,
  or `undo` / `redo` in the terminal. Ctrl+Y stays the terminal window.

## Canvas connections and drawings

- `link <from> <to> [directed|undirected|both|reverse] ["label"]` connects two
  canvas items by ID; Tab lists the candidates with what they are, and
  `wb list` prints every item, arrow and drawing. `unlink <a> <b>` removes a
  connection and `ends <arrow-id> <start> <end>` sets the line ends (`none`,
  `arrow`, `dot`, `diamond`).
- On the canvas: select an item, press L, move to another with the arrow
  keys and press Enter. Selecting two items offers "Connect"; selecting an
  arrow offers its ends.
- Several pen strokes linked to a ticket together become one named drawing
  with one ID, so the ticket lists it once. Name or ungroup it from the
  selection panel, or with `wb name <drawing-id> "Name"`.
