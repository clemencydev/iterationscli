"use client"

// The LaTeX view: write a document on the left, see it typeset on the right.
// A document is a folder in Files (its main .tex file plus whatever that pulls
// in); it is compiled to PDF in this browser by lib/latex-engine.ts. Around
// the editor: the document's files, an outline, a package browser and a font
// picker, and the problems TeX reported in plain words.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { Workspace } from "@/lib/alpha"
import {
  addFile,
  addProject,
  deleteFile,
  fileKind,
  folderPath,
  formatBytes,
  isTexFile,
  isTexSource,
  projectFiles,
  texProjects,
  updateFile,
} from "@/lib/files"
import { putBlob, getText } from "@/lib/file-store"
import {
  addPackage,
  analyze,
  completions,
  currentFont,
  findMainFile,
  FONTS,
  needsRerun,
  outline,
  PACKAGES,
  parseLog,
  setFont,
  TEMPLATES,
  wordCount,
  type Diagnostic,
  type Template,
} from "@/lib/latex"
import {
  cancelCompile,
  compileLatex,
  engineCached,
  ENGINE_NAME,
} from "@/lib/latex-engine"
import {
  createLatexProject,
  createProjectFile,
  readProject,
} from "@/lib/latex-project"
import LatexSource from "./LatexSource"
import { Divider } from "./Panes"
import PdfView from "./PdfView"
import styles from "./latex.module.css"

type Change = (
  fn: (current: Workspace) => Workspace,
  message?: string
) => boolean
/** The document being edited (its folder; undefined is loose top-level files) and the file shown. */
export type LatexOpen = { folder: string | undefined; file?: string } | null
type Props = {
  w: Workspace
  change: Change
  /** A change that is bookkeeping, not an undo step (a file's size after saving). */
  amend: (fn: (current: Workspace) => Workspace) => void
  open: LatexOpen
  onOpen: (open: LatexOpen) => void
  onImport: (
    files: File[],
    where?: { folder?: string; taskId?: string }
  ) => Promise<string[]>
  /** Opens a file that is not text (an image, the PDF) in Annotate. */
  onAnnotate: (fileId: string) => void
  notify: (message: string) => void
}

const AUTO = "iterations:latex-auto"
const CATEGORIES: [Template["category"], string][] = [
  ["resume", "Resumes and CVs"],
  ["letter", "Letters"],
  ["article", "Articles"],
  ["report", "Reports"],
  ["slides", "Slides"],
  ["notes", "Notes"],
  ["other", "Other"],
]
const FONT_KINDS: [string, string][] = [
  ["serif", "Serif"],
  ["sans", "Sans serif"],
  ["mono", "Monospace"],
  ["math", "Maths"],
  ["icons", "Icons"],
]
/** "./chapters/a.tex" and "/main.tex", as TeX logs write them, as document paths. */
const logPath = (file: string) => file.replace(/^\.?\/+/, "")

export default function LatexEditor(props: Props) {
  const { w, open } = props
  // A document whose folder is gone (deleted, or undone away) cannot be shown.
  const exists =
    open &&
    (open.folder === undefined ||
      (w.folders ?? []).some((f) => f.id === open.folder))
  if (!open || !exists) return <Gallery {...props} />
  return <DocumentView key={open.folder ?? "loose"} {...props} open={open} />
}

// ---- Choosing or starting a document ---------------------------------------

function Gallery({ w, change, onOpen, onImport, notify }: Props) {
  const [busy, setBusy] = useState(false)
  const projects = texProjects(w)
  const start = async (template: Template) => {
    if (busy) return
    setBusy(true)
    try {
      const made = await createLatexProject(change, template.name, template)
      if (made) onOpen(made)
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not make the document."
      )
    } finally {
      setBusy(false)
    }
  }
  const bring = async (list: FileList | null) => {
    const picked = [...(list ?? [])]
    if (!picked.length) return
    setBusy(true)
    const name =
      picked.find((f) => isTexFile(f.name))?.name.replace(/\.[^.]+$/, "") ??
      "Imported document"
    let folder: string | undefined
    change((current) => {
      const made = addProject(current, name, [])
      folder = made.folder
      return made.workspace
    })
    const ids = await onImport(picked, { folder })
    setBusy(false)
    if (folder && ids.length) onOpen({ folder })
  }
  return (
    <section className={styles.gallery}>
      <p className={styles.eyebrow}>WRITE IT. TYPESET IT.</p>
      <h1>
        LaTeX <small>{projects.length}</small>
      </h1>
      <p className={styles.muted}>
        Write LaTeX and see the PDF beside it, compiled in this browser with a
        real TeX Live: packages are fetched as a document asks for them, and
        nothing you write leaves this device. A document is a folder in Files,
        so its images, bibliography and chapters sit beside it.
      </p>
      {projects.length > 0 && (
        <>
          <h2>Your documents</h2>
          <div className={styles.cards}>
            {projects.map((project) => (
              <button
                key={project.folder ?? "loose"}
                className={styles.card}
                onClick={() => onOpen({ folder: project.folder })}
              >
                <strong>{project.name}</strong>
                <small>
                  {projectFiles(w, project.folder).length} file
                  {projectFiles(w, project.folder).length === 1 ? "" : "s"}
                </small>
              </button>
            ))}
          </div>
        </>
      )}
      {CATEGORIES.map(([category, title]) => {
        const templates = TEMPLATES.filter((t) => t.category === category)
        if (!templates.length) return null
        return (
          <div key={category}>
            <h2>{title}</h2>
            <div className={styles.cards}>
              {templates.map((template) => (
                <button
                  key={template.id}
                  className={styles.card}
                  disabled={busy}
                  onClick={() => void start(template)}
                  title={`Start a document from ${template.name}`}
                >
                  <strong>{template.name}</strong>
                  <span>{template.description}</span>
                  <small>
                    {template.files.length} file
                    {template.files.length === 1 ? "" : "s"}
                  </small>
                </button>
              ))}
            </div>
          </div>
        )
      })}
      <h2>Already have one?</h2>
      <label className={styles.upload}>
        {busy ? "Working…" : "Import .tex files…"}
        <input
          type="file"
          multiple
          disabled={busy}
          onChange={(e) => {
            void bring(e.target.files)
            e.target.value = ""
          }}
        />
      </label>
      <p className={styles.hint}>
        Pick the .tex file together with everything it uses: images, .bib,
        .cls and .sty files. They become one document.
      </p>
    </section>
  )
}

// ---- A document ------------------------------------------------------------

type Run = {
  status: "idle" | "running" | "done" | "failed"
  message: string
}
type Rail = "files" | "outline" | "packages" | "fonts"

function DocumentView({
  w,
  change,
  amend,
  open,
  onOpen,
  onImport,
  onAnnotate,
  notify,
}: Props & { open: NonNullable<LatexOpen> }) {
  const root = open.folder
  const entries = useMemo(() => projectFiles(w, root), [w, root])
  const sources = useMemo(
    () => entries.filter((entry) => isTexSource(entry.file.name)),
    [entries]
  )
  /** The text of each source file, by file id, as the editor has it now. */
  const [texts, setTexts] = useState<Record<string, string>>({})
  /** Files whose contents are in another browser. */
  const [absent, setAbsent] = useState<Set<string>>(new Set())
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [run, setRun] = useState<Run>({ status: "idle", message: "" })
  const [log, setLog] = useState("")
  const [problems, setProblems] = useState<Diagnostic[]>([])
  const [showProblems, setShowProblems] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [rail, setRail] = useState<Rail | null>("files")
  const [ratio, setRatio] = useState(0.5)
  const [narrow, setNarrow] = useState(false)
  const [showing, setShowing] = useState<"source" | "pdf">("source")
  const [goto, setGoto] = useState<{ line: number; request: number } | null>(
    null
  )
  const [cursorLine, setCursorLine] = useState(1)
  const [search, setSearch] = useState("")
  const [auto, setAuto] = useState(() => {
    try {
      return localStorage.getItem(AUTO) !== "0"
    } catch {
      return true
    }
  })
  // The first compile downloads the engine; after that compiling is automatic.
  const [engineReady, setEngineReady] = useState(engineCached)
  /** Counts the writer's edits, so a compile can follow each pause in typing. */
  const [edits, setEdits] = useState(0)
  /** The text completion is built from: the active file once typing pauses. */
  const [settled, setSettled] = useState("")
  const frame = useRef<HTMLElement>(null)

  // ---- Reading the document's files
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const { file } of sources) {
      if (asked.current.has(file.id)) continue
      asked.current.add(file.id)
      void getText(file.blob).then((text) => {
        if (text === undefined)
          setAbsent((prev) => new Set(prev).add(file.id))
        setTexts((prev) =>
          file.id in prev ? prev : { ...prev, [file.id]: text ?? "" }
        )
      })
    }
  }, [sources])
  const loaded = sources.every(({ file }) => file.id in texts)

  const main = useMemo(() => {
    const path = findMainFile(
      sources
        .filter(({ file }) => isTexFile(file.name) && file.id in texts)
        .map(({ file, path }) => ({ name: path, text: texts[file.id] }))
    )
    return sources.find((entry) => entry.path === path)
  }, [sources, texts])
  const active =
    sources.find((entry) => entry.file.id === open.file) ??
    main ??
    sources.find((entry) => isTexFile(entry.file.name)) ??
    sources[0]
  const text = active ? (texts[active.file.id] ?? "") : ""
  const mainText = main ? (texts[main.file.id] ?? "") : ""

  // ---- Saving: each change is written to this device shortly after typing stops
  const unsaved = useRef(new Map<string, string>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // What work that finishes later (a save, a compile) must read as it is then.
  const latest = useRef({ entries, texts, main, root, w, edits, amend, notify })
  useEffect(() => {
    latest.current = { entries, texts, main, root, w, edits, amend, notify }
  })
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current)
    const pending = [...unsaved.current]
    unsaved.current.clear()
    for (const [id, value] of pending) {
      const entry = latest.current.entries.find((e) => e.file.id === id)
      if (!entry) continue
      const blob = new Blob([value], { type: entry.file.mime })
      void putBlob(blob, entry.file.blob).then(
        () =>
          latest.current.amend((current) =>
            (current.files ?? []).some((f) => f.id === id)
              ? updateFile(current, id, { size: blob.size })
              : current
          ),
        () => latest.current.notify("This browser could not save the file.")
      )
    }
  }, [])
  useEffect(() => flush, [flush])
  const write = useCallback(
    (id: string, value: string) => {
      setTexts((prev) => ({ ...prev, [id]: value }))
      setEdits((n) => n + 1)
      unsaved.current.set(id, value)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flush, 700)
    },
    [flush]
  )

  // ---- Compiling
  const running = useRef(false)
  const again = useRef(false)
  /** The edit count the last compile included; -1 before the first one. */
  const covered = useRef(-1)
  const compile = useCallback(async () => {
    if (running.current) {
      again.current = true
      return
    }
    running.current = true
    try {
      do {
        again.current = false
        const now = latest.current
        covered.current = now.edits
        if (!now.main) {
          setRun({
            status: "failed",
            message:
              "Nothing to compile: no .tex file here has \\documentclass and \\begin{document}.",
          })
          break
        }
        setRun({ status: "running", message: "Starting…" })
        const { files, missing } = await readProject(now.w, now.root, now.texts)
        const job = {
          files,
          main: now.main.path,
          onProgress: (message: string) =>
            setRun({ status: "running", message }),
        }
        let result = await compileLatex(job)
        // TeX sometimes needs one more run than the engine gave it (hyperref's
        // bookmarks, a table of contents that moved): give it up to two.
        for (
          let extra = 0;
          extra < 2 && result.ok && needsRerun(result.log) && !again.current;
          extra++
        ) {
          setRun({ status: "running", message: "Running once more…" })
          const next = await compileLatex(job)
          if (!next.ok) break
          result = { ...next, ms: result.ms + next.ms, passes: result.passes + next.passes }
        }
        if (result.cancelled) {
          setRun({ status: "idle", message: "Stopped." })
          break
        }
        // Shell escape is always off in this compiler; graphicx remarks on
        // it in every document, and there is nothing to do about it.
        const found = parseLog(result.log, now.main.path).filter(
          (d) => !/Shell escape feature is not enabled/.test(d.message)
        )
        if (!result.ok && !found.some((d) => d.severity === "error"))
          found.unshift({
            severity: "error",
            message: result.timedOut
              ? "The compile took too long and was stopped."
              : (result.error ?? "The document could not be compiled."),
          })
        for (const path of missing)
          found.push({
            severity: "warning",
            message: `${path} was left out: its contents are not on this device.`,
            hint: "Import the file again in this browser.",
          })
        setProblems(found)
        setLog(result.log)
        if (result.ok && result.pdf) {
          setPdf(result.pdf)
          setEngineReady(true)
        } else setShowProblems(true)
        const seconds = (result.ms / 1000).toFixed(1)
        setRun({
          status: result.ok ? "done" : "failed",
          message: result.ok
            ? `Compiled in ${seconds} s${result.passes > 1 ? ` (${result.passes} passes)` : ""}`
            : "Could not compile. See the problems below.",
        })
      } while (again.current)
    } finally {
      running.current = false
    }
  }, [])
  // After each pause in typing, and when the document first opens.
  useEffect(() => {
    if (!auto || !engineReady || !loaded || covered.current === edits) return
    const timer = setTimeout(() => void compile(), edits ? 1200 : 0)
    return () => clearTimeout(timer)
  }, [edits, auto, engineReady, loaded, compile])
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), 600)
    return () => clearTimeout(timer)
  }, [text])
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < 860)
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // ---- What the editor is told
  const paths = useMemo(() => entries.map((entry) => entry.path), [entries])
  const bibs = useMemo(
    () =>
      sources
        .filter(({ file }) => /\.bib$/i.test(file.name))
        .map(({ file }) => texts[file.id] ?? ""),
    [sources, texts]
  )
  const offered = useMemo(
    () => completions(settled, { bib: bibs, files: paths }),
    [settled, bibs, paths]
  )
  const marks = useMemo(
    () =>
      active
        ? problems
            // Only what points at a line is marked in the text; the rest is
            // in the problems list. An error without one is marked at the top.
            .filter(
              (d) =>
                (d.line !== undefined || d.severity === "error") &&
                (d.file
                  ? logPath(d.file) === active.path
                  : active.file.id === main?.file.id)
            )
            .map(({ severity, message, line, hint }) => ({
              severity,
              message,
              line,
              hint,
            }))
        : [],
    [problems, active, main]
  )
  const headings = useMemo(() => outline(text), [text])
  const here = [...headings].reverse().find((h) => h.line <= cursorLine)
  // Counted over the whole document: files the main one pulls in with
  // \input or \include are read in its place (one level is enough here).
  const counted = useMemo(() => {
    const byPath = new Map(
      sources.map(({ file, path }) => [path, texts[file.id] ?? ""])
    )
    return wordCount(
      mainText.replace(
        /\\(?:input|include|subfile)\s*\{([^}]+)\}/g,
        (whole, name: string) =>
          byPath.get(name.trim()) ?? byPath.get(`${name.trim()}.tex`) ?? whole
      )
    )
  }, [mainText, sources, texts])
  const loadedPackages = useMemo(
    () => new Set(analyze(mainText).packages.map((p) => p.name)),
    [mainText]
  )
  const needs = useMemo(() => analyze(mainText), [mainText])
  const chosenFont = currentFont(mainText)
  const errors = problems.filter((d) => d.severity === "error").length
  const warnings = problems.filter((d) => d.severity === "warning").length

  /** Rewrites the main file (adding a package, setting the font). */
  const edit = (fn: (source: string) => string, done: string) => {
    if (!main) return notify("Open a document's main .tex file first.")
    try {
      const next = fn(mainText)
      if (next !== mainText) write(main.file.id, next)
      notify(done)
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not change it.")
    }
  }
  const show = (path: string | undefined, line?: number) => {
    const entry = path
      ? sources.find((e) => e.path === logPath(path))
      : (main ?? active)
    if (!entry) return
    if (entry.file.id !== active?.file.id)
      onOpen({ folder: root, file: entry.file.id })
    if (line)
      setGoto((prev) => ({ line, request: (prev?.request ?? 0) + 1 }))
    setShowing("source")
  }
  const savePdf = async () => {
    if (!pdf || !main) return
    const name = main.file.name.replace(/\.[^.]+$/, "") + ".pdf"
    const blob = new Blob([pdf.slice()], { type: "application/pdf" })
    const existing = entries.find(
      (e) =>
        e.file.name === name &&
        e.file.folder === main.file.folder &&
        e.file.mime === "application/pdf"
    )
    try {
      if (existing) {
        await putBlob(blob, existing.file.blob)
        amend((current) =>
          updateFile(current, existing.file.id, { size: blob.size })
        )
      } else {
        const key = await putBlob(blob)
        change(
          (current) =>
            addFile(current, {
              name,
              mime: "application/pdf",
              size: blob.size,
              blob: key,
              folder: main.file.folder,
            }).workspace
        )
      }
      notify(
        `${name} ${existing ? "updated" : "saved"} in Files, beside the document. Tie it to a ticket or place it on the canvas from there.`
      )
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save the PDF.")
    }
  }
  const title =
    root === undefined ? "Loose files" : folderPath(w, root) || "Document"
  const matches = search.trim().toLowerCase()
  const packages = PACKAGES.filter(
    (p) =>
      !matches ||
      `${p.name} ${p.summary} ${p.category}`.toLowerCase().includes(matches)
  )

  const railTab = (name: Rail, label: string) => (
    <button
      role="tab"
      aria-selected={rail === name}
      onClick={() => setRail(rail === name ? null : name)}
    >
      {label}
    </button>
  )
  let panel: ReactNode = null
  if (rail === "files")
    panel = (
      <>
        <ul className={styles.files}>
          {entries.map(({ file, path }) => {
            const editable = isTexSource(file.name)
            return (
              <li
                key={file.id}
                data-active={file.id === active?.file.id ? "" : undefined}
              >
                <button
                  className={styles.fileName}
                  title={
                    editable ? `Edit ${path}` : `Open ${path} in Annotate`
                  }
                  onClick={() =>
                    editable
                      ? onOpen({ folder: root, file: file.id })
                      : onAnnotate(file.id)
                  }
                >
                  <span>{path}</span>
                  {file.id === main?.file.id && <small>main</small>}
                  {absent.has(file.id) && (
                    <small title="Its contents are in another browser">
                      not here
                    </small>
                  )}
                  {!editable && (
                    <small>
                      {fileKind(file.mime, file.name)} ·{" "}
                      {formatBytes(file.size)}
                    </small>
                  )}
                </button>
                <button
                  className={styles.remove}
                  aria-label={`Delete ${path}`}
                  title="Delete (Ctrl+Z outside the editor brings it back)"
                  onClick={() =>
                    change(
                      (current) => deleteFile(current, file.id),
                      `${path} deleted. Ctrl+Z outside the editor brings it back.`
                    )
                  }
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault()
            const form = e.currentTarget
            const path = String(new FormData(form).get("path") ?? "").trim()
            if (!path) return
            void createProjectFile(
              change,
              root,
              /\.[a-z0-9]+$/i.test(path) ? path : `${path}.tex`
            ).then((id) => {
              if (!id) return
              form.reset()
              onOpen({ folder: root, file: id })
            })
          }}
        >
          <input
            name="path"
            aria-label="New file path"
            placeholder="sections/intro.tex"
          />
          <button>+ File</button>
        </form>
        <label className={styles.upload}>
          Add images, .bib, .sty…
          <input
            type="file"
            multiple
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])]
              if (picked.length) void onImport(picked, { folder: root })
              e.target.value = ""
            }}
          />
        </label>
        <p className={styles.hint}>
          Refer to files by the path shown, e.g.{" "}
          <code>\includegraphics{"{"}logo.png{"}"}</code>. Rename and move them
          in Files.
        </p>
      </>
    )
  if (rail === "outline")
    panel = headings.length ? (
      <ul className={styles.outline}>
        {headings.map((heading) => (
          <li key={`${heading.line}-${heading.title}`}>
            <button
              data-active={heading === here ? "" : undefined}
              style={{ paddingLeft: 8 + Math.max(0, heading.level - 2) * 12 }}
              onClick={() => show(active?.path, heading.line)}
              title={`Line ${heading.line}`}
            >
              {heading.title || `(${heading.kind})`}
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className={styles.hint}>
        Headings in this file (\section, \subsection, …) are listed here.
      </p>
    )
  if (rail === "packages")
    panel = (
      <>
        <input
          aria-label="Search packages"
          placeholder="Search packages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul className={styles.packages}>
          {packages.map((p) => (
            <li key={p.name}>
              <div>
                <code>{p.name}</code>
                <small>{p.category}</small>
              </div>
              <p>{p.summary}</p>
              <button
                disabled={loadedPackages.has(p.name)}
                onClick={() =>
                  edit(
                    (source) => addPackage(source, p.name),
                    `\\usepackage{${p.name}} added to ${main?.path ?? "the main file"}.`
                  )
                }
              >
                {loadedPackages.has(p.name) ? "In use" : "Add"}
              </button>
            </li>
          ))}
        </ul>
        <p className={styles.hint}>
          Any package in TeX Live works, listed here or not: write
          \usepackage{"{"}name{"}"} and it is fetched on the next compile. For
          one that is not in TeX Live, add its .sty file to the document.
        </p>
      </>
    )
  if (rail === "fonts")
    panel = (
      <>
        <button
          className={styles.font}
          aria-pressed={!chosenFont}
          onClick={() =>
            edit((source) => setFont(source, "default"), "Font: the class default.")
          }
        >
          <strong>Class default</strong>
          <span>Whatever the document class and its packages choose.</span>
        </button>
        {FONT_KINDS.map(([kind, label]) => {
          // XeLaTeX fonts are left out: this compiler has only pdfLaTeX.
          const fonts = FONTS.filter(
            (f) => f.kind === kind && f.engine !== "xelatex"
          )
          if (!fonts.length) return null
          return (
            <div key={kind}>
              <p className={styles.caption}>{label.toUpperCase()}</p>
              {fonts.map((font) => (
                <button
                  key={font.id}
                  className={styles.font}
                  aria-pressed={chosenFont === font.id}
                  onClick={() =>
                    edit(
                      (source) => setFont(source, font.id),
                      `Font: ${font.name}.`
                    )
                  }
                >
                  <strong>{font.name}</strong>
                  <span>{font.description}</span>
                </button>
              ))}
            </div>
          )
        })}
        <p className={styles.hint}>
          Choosing one writes its lines into the preamble, between marker
          comments, so it can be changed again. Font files of your own (.ttf,
          .otf) need XeLaTeX, which this compiler does not have yet.
        </p>
      </>
    )

  const source = (
    <div className={styles.source}>
      {active ? (
        <LatexSource
          value={text}
          onChange={(value) => write(active.file.id, value)}
          fileKey={active.file.id}
          completions={offered}
          diagnostics={marks}
          onCompile={() => void compile()}
          goto={goto}
          onCursorLine={setCursorLine}
          readOnly={!(active.file.id in texts) || absent.has(active.file.id)}
          ariaLabel={`LaTeX source of ${active.path}`}
        />
      ) : (
        <div className={styles.placeholder}>
          No text file in this document yet.
          <span>Add one under Files, e.g. main.tex.</span>
        </div>
      )}
      {showProblems && (
        <div className={styles.problems} role="region" aria-label="Problems">
          <div className={styles.problemsHead}>
            <strong>
              {problems.length
                ? `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`
                : "No problems"}
            </strong>
            <button
              aria-pressed={showLog}
              disabled={!log}
              onClick={() => setShowLog(!showLog)}
            >
              Full log
            </button>
            <button
              className={styles.remove}
              aria-label="Close problems"
              onClick={() => setShowProblems(false)}
            >
              ×
            </button>
          </div>
          {showLog ? (
            <pre className={styles.log}>{log}</pre>
          ) : (
            <ul>
              {problems.map((problem, i) => (
                <li key={i} data-severity={problem.severity}>
                  <button
                    onClick={() => show(problem.file, problem.line)}
                    title="Go to it"
                  >
                    <b>{problem.severity}</b>
                    <span>
                      {problem.message}
                      {problem.hint && <em>{problem.hint}</em>}
                    </span>
                    <small>
                      {problem.file ? logPath(problem.file) : ""}
                      {problem.line ? `:${problem.line}` : ""}
                    </small>
                  </button>
                </li>
              ))}
              {!problems.length && (
                <li className={styles.hint}>
                  {run.status === "done"
                    ? "TeX had nothing to complain about."
                    : "Compile to check the document."}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
  const preview = (
    <div className={styles.preview}>
      <PdfView
        data={pdf}
        busy={run.status === "running"}
        name={(main?.file.name ?? "document.tex").replace(/\.[^.]+$/, "") + ".pdf"}
        empty={
          <div className={styles.placeholder}>
            {run.status === "running" ? (
              <>
                Compiling…<span>{run.message}</span>
              </>
            ) : run.status === "failed" ? (
              <>
                No PDF yet.
                <span>
                  The document did not compile; the problems are listed under
                  the source.
                </span>
              </>
            ) : (
              <>
                The PDF appears here.
                <span>
                  {engineReady
                    ? "Compile to typeset the document."
                    : "The first compile downloads the TeX engine, about 50 MB, once. After that it is kept in this browser and compiling takes a second or two."}
                </span>
                <button
                  className={styles.primary}
                  disabled={!loaded}
                  onClick={() => void compile()}
                >
                  Compile
                </button>
              </>
            )}
          </div>
        }
      />
    </div>
  )

  return (
    <section className={styles.latex} ref={frame}>
      <header className={styles.head}>
        <button onClick={() => onOpen(null)} title="All documents and templates">
          ← Documents
        </button>
        <div className={styles.name}>
          <strong title={title}>{title}</strong>
          <small>
            {active?.path ?? "no file"}
            {main && active && main.file.id !== active.file.id
              ? ` · compiles ${main.path}`
              : ""}
          </small>
        </div>
        <span
          className={styles.status}
          data-status={run.status}
          role="status"
          title={run.message}
        >
          {run.message}
        </span>
        {narrow && (
          <span className={styles.switch} role="tablist" aria-label="Show">
            <button
              role="tab"
              aria-selected={showing === "source"}
              onClick={() => setShowing("source")}
            >
              Source
            </button>
            <button
              role="tab"
              aria-selected={showing === "pdf"}
              onClick={() => setShowing("pdf")}
            >
              PDF
            </button>
          </span>
        )}
        <label className={styles.check} title="Compile after each pause in typing">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked)
              try {
                localStorage.setItem(AUTO, e.target.checked ? "1" : "0")
              } catch {
                // It still holds until the page is closed.
              }
            }}
          />
          Auto
        </label>
        <button disabled={!pdf} onClick={() => void savePdf()} title="Keep the PDF as a file beside the document">
          Save PDF to Files
        </button>
        {run.status === "running" ? (
          <button onClick={cancelCompile} title="Stop compiling">
            Stop
          </button>
        ) : (
          <button
            className={styles.primary}
            disabled={!loaded}
            onClick={() => void compile()}
            title="Compile (Ctrl+Enter or Ctrl+S in the editor)"
          >
            Compile
          </button>
        )}
      </header>
      {needs.engine && needs.engine !== "pdflatex" && (
        <p className={styles.notice} role="alert">
          This document asks for {needs.engine === "xelatex" ? "XeLaTeX" : "LuaLaTeX"}{" "}
          (fontspec, polyglossia or a magic comment). This compiler has only
          pdfLaTeX, so it will not compile as it is. Use a pdfLaTeX font from
          the Fonts tab instead of fontspec.
        </p>
      )}
      {needs.bibTool === "biber" && (
        <p className={styles.notice} role="alert">
          biblatex is set to use Biber, which this compiler does not have. Load
          it as \usepackage[backend=bibtex]{"{"}biblatex{"}"} and the
          bibliography will build.
        </p>
      )}
      <div className={styles.body}>
        <aside className={styles.rail} data-open={rail ? "" : undefined}>
          <div className={styles.tabs} role="tablist" aria-label="Document tools">
            {railTab("files", "Files")}
            {railTab("outline", "Outline")}
            {railTab("packages", "Packages")}
            {railTab("fonts", "Fonts")}
          </div>
          {rail && <div className={styles.panel}>{panel}</div>}
        </aside>
        <div className={styles.split}>
          {(!narrow || showing === "source") && (
            <div
              className={styles.half}
              style={narrow ? undefined : { flexGrow: ratio }}
            >
              {source}
            </div>
          )}
          {!narrow && (
            <Divider
              direction="row"
              ratio={ratio}
              onChange={(next) => setRatio(Math.min(0.8, Math.max(0.2, next)))}
              label="Resize source and preview"
            />
          )}
          {(!narrow || showing === "pdf") && (
            <div
              className={styles.half}
              style={narrow ? undefined : { flexGrow: 1 - ratio }}
            >
              {preview}
            </div>
          )}
        </div>
      </div>
      <footer className={styles.foot}>
        <button
          aria-pressed={showProblems}
          data-errors={errors ? "" : undefined}
          onClick={() => setShowProblems(!showProblems)}
          title="Show what TeX reported"
        >
          {errors} error{errors === 1 ? "" : "s"} · {warnings} warning
          {warnings === 1 ? "" : "s"}
        </button>
        <span>
          {counted.words} words · {counted.headings} headings ·{" "}
          {counted.mathInline + counted.mathDisplay} formulas
        </span>
        <span>{ENGINE_NAME}</span>
      </footer>
    </section>
  )
}
