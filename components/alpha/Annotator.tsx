"use client"

// The Annotate view: mark up any imported file. Images take drawings and
// pinned comments; video takes on-screen text, splits and cuts that export to
// a video editor; audio takes timed comments; everything takes notes. Saving
// keeps the original untouched and stores the result as a copy beside it.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react"
import { uid, type Workspace } from "@/lib/alpha"
import {
  clock,
  cutRanges,
  describeAnnotation,
  editsCsv,
  editsEdl,
  editsSrt,
  FRAME_RATES,
  keptSegments,
  marksCsv,
  parseClock,
  tidyEdits,
  type Annotation,
  type Point,
  type Shape,
  type VideoEdit,
} from "@/lib/annotations"
import {
  addFile,
  deleteFile,
  fileKind,
  filePlaces,
  fileTasks,
  filterFiles,
  folderPath,
  formatBytes,
  saveAnnotatedCopy,
  tieFile,
  updateFile,
  type FileEntry,
  type FileKind,
} from "@/lib/files"
import { download, getBlob, putBlob, useBlobUrl } from "@/lib/file-store"
import { FileThumb, flattenImage, KIND_GLYPH, ShapeLayer } from "./Shapes"
import styles from "./annotator.module.css"

type Change = (
  fn: (current: Workspace) => Workspace,
  message?: string
) => boolean
type Props = {
  w: Workspace
  /** The file being annotated, or null to choose one. */
  fileId: string | null
  onPick: (id: string | null) => void
  /** Unsaved work, by file. Kept by the workspace so closing the view loses nothing. */
  drafts: Record<string, Annotation>
  onDraft: (fileId: string, annotation: Annotation | undefined) => void
  change: Change
  /** Imports files into the explorer and returns their ids. */
  onImport: (files: File[]) => Promise<string[]>
  onOpenTask: (id: string) => void
  /** Puts a file on the canvas. */
  onPlace: (fileId: string) => void
  notify: (message: string) => void
}

const KIND_NAMES: Record<FileKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  text: "Text",
  pdf: "PDF",
  other: "File",
}
const COLORS = ["#f87171", "#fbbf24", "#4ade80", "#60a5fa", "#c084fc", "#ffffff", "#000000"]
const WIDTHS: [number, string][] = [
  [2, "Thin"],
  [4, "Medium"],
  [8, "Thick"],
  [14, "Heavy"],
]
type Tool = Shape["kind"] | "pin" | "erase"
const TOOLS: [Tool, string, string][] = [
  ["pen", "Pen", "Draw freehand"],
  ["line", "Line", "Draw a straight line"],
  ["arrow", "Arrow", "Draw an arrow"],
  ["rect", "Box", "Draw a rectangle"],
  ["ellipse", "Ellipse", "Draw an ellipse"],
  ["text", "Text", "Click the picture, then type"],
  ["pin", "Comment", "Click the picture to pin a numbered comment"],
  ["erase", "Erase", "Click a drawing or comment to remove it"],
]
const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value))

/** The size of an element, kept current as it resizes. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}
/** The largest box of the given proportions that fits, in px. */
function fitBox(
  space: { width: number; height: number },
  natural: { width: number; height: number } | null
) {
  if (!natural || !space.width || !space.height) return null
  const scale = Math.min(
    space.width / natural.width,
    space.height / natural.height
  )
  return { width: natural.width * scale, height: natural.height * scale }
}

export default function Annotator(props: Props) {
  const { w, fileId } = props
  const file = (w.files ?? []).find((f) => f.id === fileId)
  if (!file) return <Chooser {...props} />
  return <Editor key={file.id} {...props} file={file} />
}

// ---- Choosing a file -------------------------------------------------------

function Chooser({ w, onPick, onImport, drafts }: Props) {
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const files = filterFiles(w, { query })
  const take = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    const ids = await onImport([...list])
    setBusy(false)
    if (ids.length === 1) onPick(ids[0])
  }
  return (
    <section
      className={`${styles.chooser} ${over ? styles.dropping : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setOver(false)
        void take(e.dataTransfer.files)
      }}
    >
      <p className={styles.eyebrow}>MARK IT UP. KEEP THE ORIGINAL.</p>
      <h1>
        Annotate <small>{(w.files ?? []).length}</small>
      </h1>
      <p className={styles.muted}>
        Draw and comment on images, cut and caption video for your editor,
        leave timed comments on audio, and add notes to any other file. Saving
        makes a copy in Files and leaves the original as it was.
      </p>
      <div className={styles.chooserBar}>
        <label className={styles.importButton}>
          {busy ? "Importing…" : "Import files…"}
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(e) => {
              void take(e.target.files)
              e.target.value = ""
            }}
          />
        </label>
        <input
          aria-label="Filter files"
          placeholder="Filter by name, folder or type…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {files.length ? (
        <div className={styles.grid}>
          {files.map((file) => (
            <button
              key={file.id}
              className={styles.card}
              onClick={() => onPick(file.id)}
              title={`Annotate ${file.name}`}
            >
              <FileThumb file={file} className={styles.cardThumb} />
              <strong>{file.name}</strong>
              <small>
                {KIND_NAMES[fileKind(file.mime, file.name)]} ·{" "}
                {formatBytes(file.size)}
                {file.copyOf ? " · annotated" : ""}
                {file.id in drafts ? " · unsaved" : ""}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          {(w.files ?? []).length
            ? "No file matches that filter."
            : "Nothing to annotate yet."}
          <span>
            Import files with the button above, or drop them anywhere on this
            pane. Images, video, audio and every other type are accepted.
          </span>
        </div>
      )}
    </section>
  )
}

// ---- The editor ------------------------------------------------------------

const EMPTY: Annotation = {}

function Editor({
  w,
  file,
  onPick,
  drafts,
  onDraft,
  change,
  onOpenTask,
  onPlace,
  notify,
}: Props & { file: FileEntry }) {
  const kind = fileKind(file.mime, file.name)
  const url = useBlobUrl(file.blob)
  const annotation = drafts[file.id] ?? file.annotation ?? EMPTY
  const dirty = file.id in drafts
  const edit = (patch: Partial<Annotation>) =>
    onDraft(file.id, { ...annotation, ...patch })
  const [tie, setTie] = useState(true)
  const [saving, setSaving] = useState(false)
  // The length of the audio or video, once the browser has read it.
  const [duration, setDuration] = useState(annotation.duration ?? 0)
  const original = file.copyOf
    ? (w.files ?? []).find((f) => f.id === file.copyOf)
    : undefined
  const places = filePlaces(w, file)
  const tasks = fileTasks(w, file)
  const notes = annotation.notes ?? []
  const timed = kind === "video" || kind === "audio"
  const exported = {
    name: file.name,
    duration,
    edits: annotation.edits ?? [],
    marks: annotation.marks ?? [],
    fps: annotation.fps ?? 30,
  }
  const base = file.name.replace(/\.[^.]+$/, "")

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const result: Annotation = {
        ...annotation,
        ...(timed && duration ? { duration } : {}),
      }
      // A video's changes also go into the explorer as the CSV an editor reads.
      const csv =
        kind === "video" && (result.edits?.length || result.marks?.length)
          ? editsCsv({ ...exported, name: file.name })
          : null
      const csvKey = csv
        ? await putBlob(new Blob([csv], { type: "text/csv" }))
        : null
      let saved = file.id
      const done = change((current) => {
        let next: Workspace
        if (file.copyOf) next = updateFile(current, file.id, { annotation: result })
        else {
          const copy = saveAnnotatedCopy(current, file.id, result, { tie })
          next = copy.workspace
          saved = copy.id
        }
        const target = (next.files ?? []).find((f) => f.id === saved)!
        const old = (next.files ?? []).find(
          (f) => f.copyOf === saved && f.mime === "text/csv"
        )
        if (old) next = deleteFile(next, old.id)
        if (csv && csvKey)
          next = addFile(next, {
            name: `${target.name.replace(/\.[^.]+$/, "")}.edits.csv`,
            mime: "text/csv",
            size: new Blob([csv]).size,
            blob: csvKey,
            folder: target.folder,
            copyOf: saved,
            ...(target.taskIds?.length ? { taskIds: [...target.taskIds] } : {}),
          }).workspace
        return next
      })
      if (!done) return
      onDraft(file.id, undefined)
      if (saved !== file.id) onPick(saved)
      notify(
        file.copyOf
          ? "Saved."
          : `Saved as a copy in Files${csv ? ", with its edits as a CSV" : ""}. The original is unchanged.`
      )
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  async function downloadFile() {
    try {
      if (kind === "image" && url && (annotation.shapes?.length || annotation.pins?.length))
        return download(
          `${base}${file.copyOf ? "" : " (annotated)"}.png`,
          await flattenImage(url, annotation.shapes, annotation.pins)
        )
      const blob = await getBlob(file.blob)
      if (!blob) return notify("This file's contents are not on this device.")
      download(file.name, blob)
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not download.")
    }
  }

  const others = (w.files ?? []).filter((f) => f.id !== file.id)
  return (
    <section className={styles.annotator}>
      <header className={styles.head}>
        <button onClick={() => onPick(null)} title="Back to all files">
          ← Files
        </button>
        <div className={styles.name}>
          <strong title={file.name}>{file.name}</strong>
          <small>
            {KIND_NAMES[kind]} · {formatBytes(file.size)}
            {file.width && file.height ? ` · ${file.width}×${file.height}` : ""}
            {folderPath(w, file.folder) ? ` · ${folderPath(w, file.folder)}` : ""}
            {file.copyOf
              ? ` · annotated copy${original ? ` of ${original.name}` : ""}`
              : ""}
          </small>
        </div>
        {others.length > 0 && (
          <select
            aria-label="Open another file"
            value=""
            onChange={(e) => e.target.value && onPick(e.target.value)}
          >
            <option value="">Open another…</option>
            {others.map((f) => (
              <option key={f.id} value={f.id}>
                {KIND_GLYPH[fileKind(f.mime, f.name)]} {f.name}
              </option>
            ))}
          </select>
        )}
        {dirty && <span className={styles.unsaved}>Unsaved changes</span>}
        {dirty && (
          <button
            onClick={() => onDraft(file.id, undefined)}
            title="Throw away the changes since the last save"
          >
            Discard
          </button>
        )}
        <button
          className={styles.save}
          disabled={saving || (!dirty && !!file.copyOf)}
          onClick={() => void save()}
          title={
            file.copyOf
              ? "Save the changes to this copy"
              : "Save the annotation as a copy; the original stays as it is"
          }
        >
          {saving ? "Saving…" : file.copyOf ? "Save changes" : "Save as copy"}
        </button>
      </header>
      <div className={styles.body}>
        <div className={styles.work}>
          {url === undefined ? (
            <div className={styles.placeholder}>Loading…</div>
          ) : url === null ? (
            <div className={styles.placeholder}>
              This file was imported on another device.
              <span>
                Its contents are stored in that browser only, so there is
                nothing to show here. The comments and edits are still listed
                beside it.
              </span>
            </div>
          ) : kind === "image" ? (
            <ImageStage
              url={url}
              file={file}
              annotation={annotation}
              edit={edit}
            />
          ) : timed ? (
            <MediaStage
              video={kind === "video"}
              url={url}
              file={file}
              annotation={annotation}
              edit={edit}
              duration={duration}
              onDuration={setDuration}
            />
          ) : (
            <Preview url={url} kind={kind} file={file} />
          )}
        </div>
        <aside className={styles.side}>
          <Section title="Tied to">
            <div className={styles.chips}>
              {tasks.map((id) => {
                const task = w.tasks.find((t) => t.id === id)!
                const direct = file.taskIds?.includes(id)
                return (
                  <span key={id} className={styles.chip}>
                    <button
                      onClick={() => onOpenTask(id)}
                      title="Open this ticket"
                    >
                      {task.title}
                    </button>
                    {direct ? (
                      <button
                        aria-label={`Untie from ${task.title}`}
                        title="Untie"
                        onClick={() =>
                          change((c) => tieFile(c, file.id, id, false))
                        }
                      >
                        ×
                      </button>
                    ) : (
                      <small title="Through the folder this file is in">
                        folder
                      </small>
                    )}
                  </span>
                )
              })}
              {places.objects.length > 0 && (
                <span className={styles.chip}>
                  canvas × {places.objects.length}
                </span>
              )}
              {!tasks.length && !places.objects.length && (
                <small>Not tied to a ticket or the canvas yet.</small>
              )}
            </div>
            <div className={styles.row}>
              <select
                aria-label="Tie to a ticket"
                value=""
                disabled={!w.tasks.length}
                onChange={(e) =>
                  e.target.value &&
                  change(
                    (c) => tieFile(c, file.id, e.target.value),
                    "Tied to the ticket. It is listed under the ticket's files."
                  )
                }
              >
                <option value="">
                  {w.tasks.length ? "Tie to a ticket…" : "No tickets yet"}
                </option>
                {w.tasks
                  .filter((t) => !tasks.includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
              <button onClick={() => onPlace(file.id)}>Place on canvas</button>
            </div>
            {!file.copyOf && (
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={tie}
                  onChange={(e) => setTie(e.target.checked)}
                />
                Tie the saved copy to the same tickets and canvas places
              </label>
            )}
          </Section>
          {kind === "image" && (
            <Section title="Comments" count={annotation.pins?.length ?? 0}>
              {(annotation.pins ?? []).map((pin, i) => (
                <div className={styles.item} key={pin.id}>
                  <span className={styles.pinNumber}>{i + 1}</span>
                  <textarea
                    aria-label={`Comment ${i + 1}`}
                    placeholder="What about this spot?"
                    value={pin.text}
                    autoFocus={!pin.text}
                    onChange={(e) =>
                      edit({
                        pins: (annotation.pins ?? []).map((p) =>
                          p.id === pin.id ? { ...p, text: e.target.value } : p
                        ),
                      })
                    }
                  />
                  <button
                    className={styles.remove}
                    aria-label={`Delete comment ${i + 1}`}
                    title="Delete"
                    onClick={() =>
                      edit({
                        pins: (annotation.pins ?? []).filter(
                          (p) => p.id !== pin.id
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {!annotation.pins?.length && (
                <small>
                  Pick the Comment tool and click the picture to pin one.
                </small>
              )}
            </Section>
          )}
          <Section title="Notes" count={notes.length}>
            {notes.map((note, i) => (
              <div className={styles.item} key={i}>
                <p>{note}</p>
                <button
                  className={styles.remove}
                  aria-label={`Delete note ${i + 1}`}
                  title="Delete"
                  onClick={() =>
                    edit({ notes: notes.filter((_, index) => index !== i) })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <form
              className={styles.row}
              onSubmit={(e) => {
                e.preventDefault()
                const field = e.currentTarget.elements.namedItem(
                  "note"
                ) as HTMLInputElement
                const text = field.value.trim()
                if (!text) return
                edit({ notes: [...notes, text] })
                field.value = ""
              }}
            >
              <input
                name="note"
                aria-label="Note about this file"
                placeholder="A note about the whole file…"
              />
              <button>Add</button>
            </form>
          </Section>
          <Section title="Export">
            <div className={styles.row}>
              <button onClick={() => void downloadFile()}>
                {kind === "image" &&
                (annotation.shapes?.length || annotation.pins?.length)
                  ? "Download PNG ↓"
                  : "Download file ↓"}
              </button>
            </div>
            {kind === "video" && (
              <>
                <div className={styles.row}>
                  <button
                    disabled={!duration}
                    title="Every change as a spreadsheet: clips to keep, cuts, splits, text and comments"
                    onClick={() =>
                      download(`${base}.edits.csv`, editsCsv(exported), "text/csv")
                    }
                  >
                    CSV ↓
                  </button>
                  <button
                    disabled={!duration}
                    title="CMX 3600 edit decision list: import it as a timeline in Premiere Pro, DaVinci Resolve and others"
                    onClick={() => download(`${base}.edl`, editsEdl(exported))}
                  >
                    EDL ↓
                  </button>
                  <button
                    disabled={!duration}
                    title="The on-screen text as subtitles, timed against the edited clip"
                    onClick={() => download(`${base}.srt`, editsSrt(exported))}
                  >
                    SRT ↓
                  </button>
                </div>
                <label className={styles.inline}>
                  Frame rate
                  <select
                    value={annotation.fps ?? 30}
                    onChange={(e) => edit({ fps: Number(e.target.value) })}
                  >
                    {FRAME_RATES.map((rate) => (
                      <option key={rate} value={rate}>
                        {rate} fps
                      </option>
                    ))}
                  </select>
                </label>
                <small>
                  Nothing is re-encoded here. The EDL rebuilds the cuts as a
                  timeline in your editor, the SRT brings the text in as
                  captions, and the CSV lists everything. Set the frame rate to
                  the video&apos;s so timecodes land on the right frames.
                </small>
              </>
            )}
            {kind === "audio" && (
              <div className={styles.row}>
                <button
                  disabled={!annotation.marks?.length}
                  onClick={() =>
                    download(
                      `${base}.comments.csv`,
                      marksCsv(file.name, annotation.marks ?? []),
                      "text/csv"
                    )
                  }
                >
                  Comments CSV ↓
                </button>
              </div>
            )}
            {describeAnnotation(annotation) && (
              <small>{describeAnnotation(annotation)}</small>
            )}
          </Section>
        </aside>
      </div>
    </section>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <div className={styles.section}>
      <h2>
        {title}
        {count !== undefined && <small>{count}</small>}
      </h2>
      {children}
    </div>
  )
}

// ---- Images ----------------------------------------------------------------

function ImageStage({
  url,
  file,
  annotation,
  edit,
}: {
  url: string
  file: FileEntry
  annotation: Annotation
  edit: (patch: Partial<Annotation>) => void
}) {
  const [tool, setTool] = useState<Tool>("pen")
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(4)
  const [draft, setDraft] = useState<Shape | null>(null)
  const [typing, setTyping] = useState<{ at: Point; value: string } | null>(null)
  const [activePin, setActivePin] = useState<string | null>(null)
  const [natural, setNatural] = useState(
    file.width && file.height
      ? { width: file.width, height: file.height }
      : null
  )
  const [space, size] = useSize<HTMLDivElement>()
  const frame = useRef<HTMLDivElement>(null)
  // The shape under the pointer; pointer events can outrun rendering.
  const drawing = useRef<Shape | null>(null)
  const box = fitBox(size, natural)
  const shapes = annotation.shapes ?? []
  const pins = annotation.pins ?? []

  const point = (e: ReactPointerEvent): Point => {
    const rect = frame.current!.getBoundingClientRect()
    return [
      clamp((e.clientX - rect.left) / rect.width),
      clamp((e.clientY - rect.top) / rect.height),
    ]
  }
  // Where text was last placed, so Enter followed by the field losing focus
  // places it once.
  const placed = useRef<Point | null>(null)
  const commitText = (typed = typing) => {
    if (!typed || placed.current === typed.at) return
    placed.current = typed.at
    if (typed.value.trim())
      edit({
        shapes: [
          ...shapes,
          {
            id: uid(),
            kind: "text",
            at: typed.at,
            text: typed.value.trim(),
            color,
            size: 14 + width * 5,
          },
        ],
      })
    // A click elsewhere may already have started the next piece of text.
    setTyping((now) => (now === typed ? null : now))
  }
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || tool === "erase") return
    if ((e.target as HTMLElement).closest("input")) return
    const p = point(e)
    if (tool === "text") {
      if (typing) commitText()
      return setTyping({ at: p, value: "" })
    }
    if (tool === "pin") {
      const pin = { id: uid(), at: p, text: "" }
      edit({ pins: [...pins, pin] })
      return setActivePin(pin.id)
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current =
      tool === "pen"
        ? { id: uid(), kind: "pen", points: [p], color, width }
        : { id: uid(), kind: tool, from: p, to: p, color, width }
    setDraft(drawing.current)
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const shape = drawing.current
    if (!shape) return
    const p = point(e)
    if (shape.kind === "pen") {
      const last = shape.points[shape.points.length - 1]
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002) return
      drawing.current = { ...shape, points: [...shape.points, p] }
    } else if (shape.kind !== "text") drawing.current = { ...shape, to: p }
    setDraft(drawing.current)
  }
  const up = () => {
    const shape = drawing.current
    drawing.current = null
    setDraft(null)
    if (!shape || shape.kind === "text") return
    const drawn =
      shape.kind === "pen"
        ? shape.points.length > 1
        : Math.hypot(shape.to[0] - shape.from[0], shape.to[1] - shape.from[1]) >
          0.005
    if (drawn) edit({ shapes: [...shapes, shape] })
  }

  return (
    <>
      <div className={styles.tools} role="toolbar" aria-label="Drawing tools">
        {TOOLS.map(([name, label, title]) => (
          <button
            key={name}
            aria-pressed={tool === name}
            title={title}
            onClick={() => setTool(name)}
          >
            {label}
          </button>
        ))}
        <span className={styles.gap} />
        {COLORS.map((c) => (
          <button
            key={c}
            className={styles.swatch}
            aria-pressed={color === c}
            aria-label={`Color ${c}`}
            title={c}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
        <input
          type="color"
          aria-label="Custom color"
          title="Custom color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <select
          aria-label="Line weight"
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
        >
          {WIDTHS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className={styles.gap} />
        <button
          disabled={!shapes.length}
          title="Remove the last drawing"
          onClick={() => edit({ shapes: shapes.slice(0, -1) })}
        >
          Undo
        </button>
        <button
          disabled={!shapes.length && !pins.length}
          title="Remove every drawing and comment"
          onClick={() => edit({ shapes: [], pins: [] })}
        >
          Clear
        </button>
      </div>
      <div className={styles.stage} ref={space}>
        <div
          ref={frame}
          className={styles.frame}
          data-tool={tool}
          style={box ?? { visibility: "hidden" }}
          onPointerDown={down}
          // Keeps the keyboard where a click just put it (the text being
          // typed, a new comment) instead of letting the press take it away.
          onMouseDown={(e) => {
            if (!(e.target as HTMLElement).closest("input")) e.preventDefault()
          }}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          {/* A blob URL from this device's file store, not a remote image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={file.name}
            draggable={false}
            onLoad={(e) => {
              const image = e.currentTarget
              if (!natural && image.naturalWidth)
                setNatural({
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                })
            }}
          />
          {natural && (
            <ShapeLayer
              className={styles.layer}
              shapes={shapes}
              pins={pins}
              draft={draft}
              aspect={natural.height / natural.width}
              activePin={activePin}
              onShape={
                tool === "erase"
                  ? (id) => edit({ shapes: shapes.filter((s) => s.id !== id) })
                  : undefined
              }
              onPin={(id) =>
                tool === "erase"
                  ? edit({ pins: pins.filter((p) => p.id !== id) })
                  : setActivePin(id)
              }
            />
          )}
          {typing && (
            <input
              key={typing.at.join()}
              className={styles.typing}
              autoFocus
              aria-label="Text to place on the picture"
              placeholder="Type, then Enter"
              value={typing.value}
              style={{
                left: `${typing.at[0] * 100}%`,
                top: `${typing.at[1] * 100}%`,
                color,
              }}
              onChange={(e) => setTyping({ ...typing, value: e.target.value })}
              onBlur={() => commitText()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitText()
                if (e.key === "Escape") {
                  placed.current = typing.at
                  setTyping(null)
                }
              }}
            />
          )}
        </div>
      </div>
    </>
  )
}

// ---- Video and audio -------------------------------------------------------

function MediaStage({
  video,
  url,
  file,
  annotation,
  edit,
  duration,
  onDuration,
}: {
  video: boolean
  url: string
  file: FileEntry
  annotation: Annotation
  edit: (patch: Partial<Annotation>) => void
  duration: number
  onDuration: (seconds: number) => void
}) {
  // One player, whichever element it is: both are media elements.
  const media = useRef<HTMLMediaElement>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [range, setRange] = useState<{ in?: number; out?: number }>({})
  const [previewCuts, setPreviewCuts] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [natural, setNatural] = useState(
    file.width && file.height
      ? { width: file.width, height: file.height }
      : null
  )
  const [space, size] = useSize<HTMLDivElement>()
  const frame = useRef<HTMLDivElement>(null)
  const dragText = useRef<string | null>(null)
  const box = fitBox(size, natural)
  const edits = useMemo(() => annotation.edits ?? [], [annotation.edits])
  const marks = annotation.marks ?? []
  const fps = annotation.fps ?? 30
  const cuts = useMemo(() => cutRanges(edits, duration), [edits, duration])
  const segments = useMemo(
    () => keptSegments(edits, duration),
    [edits, duration]
  )
  const kept = segments.reduce((sum, s) => sum + (s.end - s.start), 0)
  const percent = (seconds: number) =>
    `${duration ? clamp(seconds / duration) * 100 : 0}%`

  // While playing, follow the playhead every frame and skip what is cut.
  useEffect(() => {
    if (!playing) return
    let request = 0
    const tick = () => {
      const element = media.current
      if (element) {
        let now = element.currentTime
        const cut = previewCuts
          ? cuts.find((c) => now >= c.start && now < c.end - 0.02)
          : undefined
        if (cut) {
          if (cut.end >= duration - 0.05) element.pause()
          else element.currentTime = now = cut.end
        }
        setTime(now)
      }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, previewCuts, cuts, duration])

  const seek = (seconds: number) => {
    const element = media.current
    if (!element) return
    const to = clamp(seconds, 0, duration || 0)
    element.currentTime = to
    setTime(to)
  }
  const toggle = () => {
    const element = media.current
    if (!element) return
    if (element.paused) void element.play().catch(() => {})
    else element.pause()
  }
  const setEdits = (next: VideoEdit[]) => edit({ edits: next })
  const patchEdit = (id: string, patch: Partial<VideoEdit>) =>
    setEdits(
      edits.map((e) => (e.id === id ? ({ ...e, ...patch } as VideoEdit) : e))
    )
  const split = () => {
    if (time <= 0.01 || time >= duration - 0.01) return
    setEdits([...edits, { id: uid(), kind: "split", at: time }])
  }
  const hasRange =
    range.in !== undefined && range.out !== undefined && range.out > range.in
  const cut = () => {
    if (!hasRange) return
    setEdits([
      ...edits,
      { id: uid(), kind: "cut", start: range.in!, end: range.out! },
    ])
    setRange({})
  }
  const addText = () => {
    const start = hasRange ? range.in! : time
    const end = hasRange ? range.out! : Math.min(duration || time + 3, time + 3)
    const id = uid()
    setEdits([
      ...edits,
      { id, kind: "text", start, end, text: "Text", x: 0.5, y: 0.85 },
    ])
    setSelected(id)
    if (hasRange) setRange({})
  }
  const scrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    seek(clamp((e.clientX - rect.left) / rect.width) * duration)
  }
  const texts = edits.filter(
    (e): e is Extract<VideoEdit, { kind: "text" }> => e.kind === "text"
  )
  const shown = texts.filter(
    (t) => (time >= t.start && time < t.end) || t.id === selected
  )
  const sorted = tidyEdits(edits, duration || Infinity)

  return (
    <div
      className={styles.media}
      tabIndex={-1}
      // Keys for editing, while the keyboard is in the player and not in a field.
      onKeyDown={(e) => {
        if (
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          (e.target as HTMLElement).closest("input,textarea,select,button")
        )
          return
        const key = e.key.toLowerCase()
        if (key === " ") toggle()
        else if (key === "arrowleft") seek(time - (e.shiftKey ? 1 / fps : 1))
        else if (key === "arrowright") seek(time + (e.shiftKey ? 1 / fps : 1))
        else if (key === "i") setRange((r) => ({ ...r, in: time }))
        else if (key === "o") setRange((r) => ({ ...r, out: time }))
        else if (key === "s" && video) split()
        else return
        e.preventDefault()
      }}
    >
      <div className={styles.stage} ref={space}>
        {video ? (
          <div
            ref={frame}
            className={styles.frame}
            style={box ?? { visibility: "hidden" }}
            onPointerMove={(e) => {
              const id = dragText.current
              if (!id || !frame.current) return
              const rect = frame.current.getBoundingClientRect()
              patchEdit(id, {
                x: clamp((e.clientX - rect.left) / rect.width),
                y: clamp((e.clientY - rect.top) / rect.height),
              })
            }}
            onPointerUp={() => {
              dragText.current = null
            }}
          >
            <video
              ref={media as RefObject<HTMLVideoElement | null>}
              src={url}
              playsInline
              preload="metadata"
              onClick={toggle}
              onLoadedMetadata={(e) => {
                const element = e.currentTarget
                if (Number.isFinite(element.duration))
                  onDuration(element.duration)
                if (!natural && element.videoWidth)
                  setNatural({
                    width: element.videoWidth,
                    height: element.videoHeight,
                  })
              }}
              onDurationChange={(e) => {
                if (Number.isFinite(e.currentTarget.duration))
                  onDuration(e.currentTarget.duration)
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            />
            {shown.map((t) => (
              <span
                key={t.id}
                className={styles.caption}
                data-selected={t.id === selected ? "" : undefined}
                title="Drag to place"
                style={{
                  left: `${t.x * 100}%`,
                  top: `${t.y * 100}%`,
                  fontSize: box ? Math.max(11, box.width * 0.035) : 16,
                }}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  frame.current?.setPointerCapture(e.pointerId)
                  dragText.current = t.id
                  setSelected(t.id)
                }}
              >
                {t.text || "Text"}
              </span>
            ))}
          </div>
        ) : (
          <div className={styles.audio}>
            <audio
              ref={media as RefObject<HTMLAudioElement | null>}
              src={url}
              preload="metadata"
              onLoadedMetadata={(e) => {
                if (Number.isFinite(e.currentTarget.duration))
                  onDuration(e.currentTarget.duration)
              }}
              onDurationChange={(e) => {
                if (Number.isFinite(e.currentTarget.duration))
                  onDuration(e.currentTarget.duration)
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            />
            <Waveform file={file} progress={duration ? time / duration : 0} />
            <p>
              Audio annotation is a work in progress: for now it takes comments
              at any moment of the recording.
            </p>
          </div>
        )}
      </div>
      <div className={styles.transport}>
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          title="Play or pause (Space)"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <code>
          {clock(time)} / {clock(duration)}
        </code>
        {video && (
          <>
            <button onClick={split} title="Split the clip at the playhead (S)">
              Split
            </button>
            <button
              aria-pressed={range.in !== undefined}
              onClick={() => setRange((r) => ({ ...r, in: time }))}
              title="Start a selection at the playhead (I)"
            >
              In
            </button>
            <button
              aria-pressed={range.out !== undefined}
              onClick={() => setRange((r) => ({ ...r, out: time }))}
              title="End the selection at the playhead (O)"
            >
              Out
            </button>
            <button
              disabled={!hasRange}
              onClick={cut}
              title="Delete the selected section"
            >
              Cut selection
            </button>
            <button
              onClick={addText}
              title="Put text on screen at the playhead, or over the selection"
            >
              + Text
            </button>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={previewCuts}
                onChange={(e) => setPreviewCuts(e.target.checked)}
              />
              Skip cuts when playing
            </label>
          </>
        )}
      </div>
      <div
        className={styles.timeline}
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={clock(time)}
        onPointerDown={(e) => {
          if (!duration) return
          e.currentTarget.setPointerCapture(e.pointerId)
          scrub(e)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e)
        }}
      >
        <div className={styles.lane}>
          {segments.map((s, i) => (
            <i
              key={`${s.start}-${s.end}`}
              className={styles.clip}
              data-odd={i % 2 ? "" : undefined}
              style={{
                left: percent(s.start),
                width: percent(s.end - s.start),
              }}
            />
          ))}
          {cuts.map((c) => (
            <i
              key={`cut-${c.start}`}
              className={styles.cut}
              title={`Cut ${clock(c.start)} – ${clock(c.end)}`}
              style={{
                left: percent(c.start),
                width: percent(c.end - c.start),
              }}
            />
          ))}
        </div>
        {video && (
          <div className={styles.lane} data-thin="">
            {texts.map((t) => (
              <i
                key={t.id}
                className={styles.textBar}
                data-selected={t.id === selected ? "" : undefined}
                title={t.text}
                style={{
                  left: percent(t.start),
                  width: percent(t.end - t.start),
                }}
              />
            ))}
          </div>
        )}
        {hasRange && (
          <i
            className={styles.selection}
            style={{
              left: percent(range.in!),
              width: percent(range.out! - range.in!),
            }}
          />
        )}
        {range.in !== undefined && (
          <i className={styles.bound} style={{ left: percent(range.in) }} />
        )}
        {range.out !== undefined && (
          <i className={styles.bound} style={{ left: percent(range.out) }} />
        )}
        {marks.map((m) => (
          <i
            key={m.id}
            className={styles.mark}
            title={`${clock(m.at)}  ${m.text}`}
            style={{ left: percent(m.at) }}
          />
        ))}
        <i className={styles.playhead} style={{ left: percent(time) }} />
      </div>
      {video && (
        <p className={styles.summary}>
          {duration
            ? `${segments.length} clip${segments.length === 1 ? "" : "s"} · ${clock(kept)} of ${clock(duration)} kept`
            : "Reading the video…"}
        </p>
      )}
      <div className={styles.lists}>
        {video && (
          <div className={styles.list}>
            <h2>
              Edits <small>{sorted.length}</small>
            </h2>
            {sorted.map((e) => (
              <div
                key={e.id}
                className={styles.edit}
                data-selected={e.id === selected ? "" : undefined}
              >
                <button
                  className={styles.kind}
                  data-kind={e.kind}
                  title="Go to this edit"
                  onClick={() => {
                    setSelected(e.id)
                    seek(e.kind === "split" ? e.at : e.start)
                  }}
                >
                  {e.kind}
                </button>
                {e.kind === "split" ? (
                  <Time
                    label="Split at"
                    value={e.at}
                    onChange={(at) => patchEdit(e.id, { at })}
                  />
                ) : (
                  <>
                    <Time
                      label="Start"
                      value={e.start}
                      onChange={(start) => patchEdit(e.id, { start })}
                    />
                    <Time
                      label="End"
                      value={e.end}
                      onChange={(end) => patchEdit(e.id, { end })}
                    />
                  </>
                )}
                {e.kind === "text" && (
                  <input
                    className={styles.grow}
                    aria-label="Text on screen"
                    placeholder="Text on screen"
                    value={e.text}
                    onFocus={() => setSelected(e.id)}
                    onChange={(event) =>
                      patchEdit(e.id, { text: event.target.value })
                    }
                  />
                )}
                <button
                  className={styles.remove}
                  aria-label={`Delete this ${e.kind}`}
                  title="Delete"
                  onClick={() => setEdits(edits.filter((x) => x.id !== e.id))}
                >
                  ×
                </button>
              </div>
            ))}
            {!sorted.length && (
              <small>
                Split at the playhead, mark In and Out to cut a section, or add
                text. Drag text on the picture to place it.
              </small>
            )}
          </div>
        )}
        <div className={styles.list}>
          <h2>
            Comments <small>{marks.length}</small>
          </h2>
          {[...marks]
            .sort((a, b) => a.at - b.at)
            .map((m) => (
              <div key={m.id} className={styles.edit}>
                <button
                  className={styles.kind}
                  title="Go to this moment"
                  onClick={() => seek(m.at)}
                >
                  {clock(m.at)}
                </button>
                <input
                  className={styles.grow}
                  aria-label={`Comment at ${clock(m.at)}`}
                  value={m.text}
                  onChange={(event) =>
                    edit({
                      marks: marks.map((x) =>
                        x.id === m.id ? { ...x, text: event.target.value } : x
                      ),
                    })
                  }
                />
                <button
                  className={styles.remove}
                  aria-label="Delete comment"
                  title="Delete"
                  onClick={() =>
                    edit({ marks: marks.filter((x) => x.id !== m.id) })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          <form
            className={styles.row}
            onSubmit={(e) => {
              e.preventDefault()
              const field = e.currentTarget.elements.namedItem(
                "comment"
              ) as HTMLInputElement
              const text = field.value.trim()
              if (!text) return
              edit({ marks: [...marks, { id: uid(), at: time, text }] })
              field.value = ""
            }}
          >
            <input
              name="comment"
              aria-label="Comment at the playhead"
              placeholder={`Comment at ${clock(time)}…`}
            />
            <button>Add</button>
          </form>
        </div>
      </div>
    </div>
  )
}

/** A time that can be typed: "1:05.3" or seconds. */
function Time({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (seconds: number) => void
}) {
  return (
    <input
      // Remounts when the value changes elsewhere, so it always shows the truth.
      key={value}
      className={styles.time}
      aria-label={label}
      title={label}
      defaultValue={clock(value)}
      onBlur={(e) => {
        const parsed = parseClock(e.target.value)
        if (parsed !== undefined && Math.abs(parsed - value) > 0.04)
          onChange(parsed)
        else e.target.value = clock(value)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
    />
  )
}

/** The loudness of a recording over time. Skipped for long files. */
function Waveform({ file, progress }: { file: FileEntry; progress: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  // Decoding holds the whole recording in memory, so only short ones get it.
  const small = file.size <= 8_000_000
  useEffect(() => {
    if (!small) return
    let current = true
    void (async () => {
      try {
        const blob = await getBlob(file.blob)
        if (!blob) return
        const context = new AudioContext()
        const audio = await context.decodeAudioData(await blob.arrayBuffer())
        void context.close()
        const samples = audio.getChannelData(0)
        const count = 400
        const step = Math.max(1, Math.floor(samples.length / count))
        const result: number[] = []
        for (let i = 0; i < count; i++) {
          let peak = 0
          for (let j = i * step; j < (i + 1) * step && j < samples.length; j += 8)
            peak = Math.max(peak, Math.abs(samples[j]))
          result.push(peak)
        }
        if (current) setPeaks(result)
      } catch {
        // No waveform: the timeline below still works.
      }
    })()
    return () => {
      current = false
    }
  }, [file.blob, small])
  useEffect(() => {
    const element = canvas.current
    const c = element?.getContext("2d")
    if (!element || !c || !peaks) return
    const { width, height } = element
    const style = getComputedStyle(element)
    c.clearRect(0, 0, width, height)
    const bar = width / peaks.length
    peaks.forEach((peak, i) => {
      c.fillStyle =
        i / peaks.length < progress
          ? style.getPropertyValue("--played")
          : style.getPropertyValue("--unplayed")
      const h = Math.max(2, peak * height)
      c.fillRect(i * bar, (height - h) / 2, Math.max(1, bar - 1), h)
    })
  }, [peaks, progress])
  if (!peaks)
    return (
      <span className={styles.note} aria-hidden="true">
        ♪
      </span>
    )
  return (
    <canvas
      ref={canvas}
      className={styles.waveform}
      width={800}
      height={140}
      aria-hidden="true"
    />
  )
}

// ---- Everything else -------------------------------------------------------

function Preview({
  url,
  kind,
  file,
}: {
  url: string
  kind: FileKind
  file: FileEntry
}) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (kind !== "text") return
    let current = true
    void fetch(url)
      .then((response) => response.text())
      .then((value) => {
        if (current) setText(value.slice(0, 200_000))
      })
      .catch(() => {
        if (current) setText("")
      })
    return () => {
      current = false
    }
  }, [url, kind])
  if (kind === "pdf")
    return <iframe className={styles.document} src={url} title={file.name} />
  if (kind === "text")
    return (
      <pre className={styles.text}>
        {text ?? "Loading…"}
        {text !== null && file.size > 200_000 && "\n… (the rest is not shown)"}
      </pre>
    )
  return (
    <div className={styles.placeholder}>
      <b aria-hidden="true">{KIND_GLYPH.other}</b>
      {file.name}
      <span>
        This type has no preview here. Add notes beside it, tie it to a ticket
        or place it on the canvas.
      </span>
    </div>
  )
}
