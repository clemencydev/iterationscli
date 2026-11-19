// What can be marked on an imported file: drawings and pinned comments on an
// image, timed comments on audio and video, and simple video edits (text,
// splits, cuts) with the files a video editor can import them from. Pure, so
// it runs under `node --test`.

/** A position inside the media, each coordinate from 0 to 1. */
export type Point = [number, number]
/**
 * A mark drawn on an image. `width` and `size` are in thousandths of the
 * image's width, so a drawing looks the same at every zoom.
 */
export type Shape =
  | { id: string; kind: "pen"; points: Point[]; color: string; width: number }
  | {
      id: string
      kind: "line" | "arrow" | "rect" | "ellipse"
      from: Point
      to: Point
      color: string
      width: number
    }
  | {
      id: string
      kind: "text"
      at: Point
      text: string
      color: string
      size: number
    }
/** A numbered comment pinned to a spot on an image. */
export type Pin = { id: string; at: Point; text: string }
/** A comment at a moment (seconds) of audio or video. */
export type Mark = { id: string; at: number; text: string }
export type VideoEdit =
  /** Text shown over the picture from `start` to `end`, centred on x, y (0–1). */
  | {
      id: string
      kind: "text"
      start: number
      end: number
      text: string
      x: number
      y: number
    }
  /** A cut point: the clip becomes two clips here. */
  | { id: string; kind: "split"; at: number }
  /** A section to remove. */
  | { id: string; kind: "cut"; start: number; end: number }

export type VideoSource = { name: string; blob: string; duration: number }

export type Annotation = {
  /** Additional media, appended in stable source-time coordinates. */
  sources?: VideoSource[]
  /** Source ranges in edited playback order. */
  clipOrder?: Segment[]
  shapes?: Shape[]
  pins?: Pin[]
  marks?: Mark[]
  edits?: VideoEdit[]
  /** Comments on the file as a whole; every kind of file can have them. */
  notes?: string[]
  /** Length of the audio or video in seconds, once it is known. */
  duration?: number
  /** Frame rate used for timecodes in exports. */
  fps?: number
}

export const SHAPE_TOOLS = [
  "pen",
  "line",
  "arrow",
  "rect",
  "ellipse",
  "text",
  "pin",
] as const
export type ShapeTool = (typeof SHAPE_TOOLS)[number]
export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]

/** How many things an annotation holds. */
export const annotationCount = (a: Annotation | undefined) =>
  (a?.shapes?.length ?? 0) +
  (a?.pins?.length ?? 0) +
  (a?.marks?.length ?? 0) +
  (a?.sources?.length ?? 0) +
  (a?.edits?.length ?? 0) +
  (a?.notes?.length ?? 0)

/** "3 drawings · 2 comments": what a file's annotation contains. */
export function describeAnnotation(a: Annotation | undefined) {
  const count = (n: number, one: string, many = `${one}s`) =>
    n ? `${n} ${n === 1 ? one : many}` : ""
  const comments =
    (a?.pins?.length ?? 0) + (a?.marks?.length ?? 0) + (a?.notes?.length ?? 0)
  return [
    count(a?.shapes?.length ?? 0, "drawing"),
    count(a?.edits?.length ?? 0, "edit"),
    count(a?.sources?.length ?? 0, "imported clip"),
    count(comments, "comment"),
  ]
    .filter(Boolean)
    .join(" · ")
}

// ---- Time ------------------------------------------------------------------

const two = (n: number) => String(n).padStart(2, "0")

/** Seconds as "1:05.3" (or "1:02:05.3"), for reading. */
export function clock(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 10) / 10)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = (total % 60).toFixed(1).padStart(4, "0")
  return h ? `${h}:${two(m)}:${s}` : `${m}:${s}`
}

/** "1:05.3", "65.3" or "1:02:05" as seconds; undefined when it is not a time. */
export function parseClock(text: string): number | undefined {
  const parts = text.trim().split(":")
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p)))
    return undefined
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}

/** Seconds as a non-drop-frame SMPTE timecode, HH:MM:SS:FF. */
export function timecode(seconds: number, fps = 30, offsetHours = 0) {
  const base = Math.round(fps)
  const frames = Math.max(0, Math.round(seconds * fps))
  const f = frames % base
  const s = Math.floor(frames / base)
  return `${two(Math.floor(s / 3600) + offsetHours)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}:${two(f)}`
}

/** Seconds as an SRT timestamp, HH:MM:SS,mmm. */
export function srtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const s = Math.floor(ms / 1000)
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)},${String(ms % 1000).padStart(3, "0")}`
}

// ---- Video edits -----------------------------------------------------------

export type Segment = { start: number; end: number }
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

/** Edits kept inside the clip, with every range the right way round, by time. */
export function tidyEdits(edits: VideoEdit[], duration: number): VideoEdit[] {
  const at = (edit: VideoEdit) => (edit.kind === "split" ? edit.at : edit.start)
  return edits
    .map((edit): VideoEdit => {
      if (edit.kind === "split")
        return { ...edit, at: clamp(edit.at, 0, duration) }
      const a = clamp(Math.min(edit.start, edit.end), 0, duration)
      const b = clamp(Math.max(edit.start, edit.end), 0, duration)
      return { ...edit, start: a, end: b }
    })
    .filter((edit) =>
      edit.kind === "split"
        ? edit.at > 0 && edit.at < duration
        : edit.end - edit.start > 0.001
    )
    .sort((a, b) => at(a) - at(b))
}

/** The removed ranges, merged where they overlap. */
export function cutRanges(edits: VideoEdit[], duration: number): Segment[] {
  const merged: Segment[] = []
  for (const edit of tidyEdits(edits, duration)) {
    if (edit.kind !== "cut") continue
    const last = merged[merged.length - 1]
    if (last && edit.start <= last.end) last.end = Math.max(last.end, edit.end)
    else merged.push({ start: edit.start, end: edit.end })
  }
  return merged
}

/**
 * What is left of the clip, in order: everything outside the cuts, broken
 * again at each split. These are the clips an editor's timeline would hold.
 */
export function keptSegments(
  edits: VideoEdit[], duration: number, order: Segment[] = [], boundaries: number[] = []
): Segment[] {
  const kept: Segment[] = []
  let from = 0
  for (const cut of cutRanges(edits, duration)) {
    if (cut.start > from) kept.push({ start: from, end: cut.start })
    from = cut.end
  }
  if (duration > from) kept.push({ start: from, end: duration })
  const splits = [...new Set([
    ...boundaries,
    ...tidyEdits(edits, duration).flatMap((edit) => edit.kind === "split" ? [edit.at] : []),
  ])].sort((a, b) => a - b)
  const segments = kept.flatMap((segment) => {
    const points = [
      segment.start,
      ...splits.filter((at) => at > segment.start && at < segment.end),
      segment.end,
    ]
    return points.slice(1).map((end, i) => ({ start: points[i], end }))
  })
  if (!order.length) return segments
  // Subsequent splits and trims inherit the position of their parent clip.
  const rank = (s: Segment) => {
    const index = order.findIndex((old) => old.start < s.end && s.start < old.end)
    return index < 0 ? order.length : index
  }
  return segments.sort((a, b) => rank(a) - rank(b))
}

export function videoSources(primary: VideoSource, extras: VideoSource[] = []) {
  let start = 0
  return [primary, ...extras].map((source) => {
    const end = start + source.duration
    const span = { ...source, start, end }
    start = end
    return span
  })
}

export function moveSegment(segments: Segment[], from: number, to: number) {
  const next = [...segments]
  if (from >= 0 && from < next.length && to >= 0 && to < next.length)
    next.splice(to, 0, ...next.splice(from, 1))
  return next
}

export function textVisibleAt(text: Segment, time: number) {
  return time >= text.start && time < text.end
}

/** Where a moment of the source lands once the cuts are made; null if cut. */
export function toRecord(at: number, segments: Segment[]): number | null {
  let elapsed = 0
  let boundary: number | null = null
  for (const segment of segments) {
    if (at >= segment.start && at < segment.end)
      return elapsed + (at - segment.start)
    elapsed += segment.end - segment.start
    if (at === segment.end) boundary = elapsed
  }
  return boundary
}

/** The part or parts of a source range that survive the cuts, in edited time. */
export function recordRanges(range: Segment, segments: Segment[]): Segment[] {
  const out: Segment[] = []
  let elapsed = 0
  for (const segment of segments) {
    const start = Math.max(range.start, segment.start)
    const end = Math.min(range.end, segment.end)
    if (end > start) {
      const a = elapsed + (start - segment.start)
      const b = elapsed + (end - segment.start)
      const last = out[out.length - 1]
      // Text running across a split stays one caption.
      if (last && Math.abs(last.end - a) < 1e-6) last.end = b
      else out.push({ start: a, end: b })
    }
    elapsed += segment.end - segment.start
  }
  return out
}

// ---- Exports ---------------------------------------------------------------

export type EditExport = {
  /** The video's file name. */
  name: string
  duration: number
  edits: VideoEdit[]
  marks?: Mark[]
  fps?: number
  /** Duration is the primary source length. */
  sources?: VideoSource[]
  clipOrder?: Segment[]
}

function exportTimeline(data: EditExport) {
  const sources = videoSources({ name: data.name, duration: data.duration, blob: "" }, data.sources)
  const duration = sources[sources.length - 1].end
  const segments = keptSegments(data.edits, duration, data.clipOrder, sources.slice(1).map((s) => s.start))
  const sourceAt = (at: number) => sources.find((s) => at < s.end) ?? sources[sources.length - 1]
  return { sources, duration, segments, sourceAt }
}

const cell = (value: string | number) => {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const seconds = (value: number) => (Math.round(value * 1000) / 1000).toString()

/**
 * Every change as one spreadsheet: the clips to keep (in order, with where
 * each lands on the edited timeline), then the cuts, splits, on-screen text
 * and comments. Timecodes are HH:MM:SS:FF at `fps`.
 */
export function editsCsv(data: EditExport) {
  const { edits, marks = [], fps = 30 } = data
  const { duration, segments, sourceAt, sources } = exportTimeline(data)
  const tidy = tidyEdits(edits, duration)
  const tc = (at: number) => timecode(at, fps)
  const rows: (string | number)[][] = [
    [
      "type",
      "source_in",
      "source_out",
      "record_in",
      "record_out",
      "source_in_seconds",
      "source_out_seconds",
      "text",
      "x_percent",
      "y_percent",
      "file",
      "fps",
    ],
  ]
  const row = (
    type: string,
    range: Segment,
    record: Segment | null,
    text = "",
    x: number | "" = "",
    y: number | "" = ""
  ) => {
    const source = sourceAt(range.start)
    const local = { start: range.start - source.start, end: range.end - source.start }
    rows.push([
      type,
      tc(local.start),
      tc(local.end),
      record ? tc(record.start) : "",
      record ? tc(record.end) : "",
      seconds(local.start),
      seconds(local.end),
      text,
      x,
      y,
      source.name,
      fps,
    ])
  }
  let elapsed = 0
  for (const segment of segments) {
    const length = segment.end - segment.start
    row("clip", segment, { start: elapsed, end: elapsed + length })
    elapsed += length
  }
  for (const edit of tidy) {
    if (edit.kind === "cut") {
      for (const source of sources) {
        const start = Math.max(edit.start, source.start)
        const end = Math.min(edit.end, source.end)
        if (start < end) row("cut", { start, end }, null)
      }
    }
    if (edit.kind === "split") {
      const at = toRecord(edit.at, segments)
      row(
        "split",
        { start: edit.at, end: edit.at },
        at === null ? null : { start: at, end: at }
      )
    }
    if (edit.kind === "text") {
      let recordStart = 0
      let visible = false
      for (const segment of segments) {
        const start = Math.max(edit.start, segment.start)
        const end = Math.min(edit.end, segment.end)
        if (end > start) {
          visible = true
          const at = recordStart + start - segment.start
          row("text", { start, end }, { start: at, end: at + end - start },
            edit.text, Math.round(edit.x * 100), Math.round(edit.y * 100))
        }
        recordStart += segment.end - segment.start
      }
      if (!visible) for (const source of sources) {
        const start = Math.max(edit.start, source.start)
        const end = Math.min(edit.end, source.end)
        if (end > start) row("text", { start, end }, null, edit.text, Math.round(edit.x * 100), Math.round(edit.y * 100))
      }
    }
  }
  for (const mark of [...marks].sort((a, b) => a.at - b.at)) {
    const at = toRecord(mark.at, segments)
    row(
      "comment",
      { start: mark.at, end: mark.at },
      at === null ? null : { start: at, end: at },
      mark.text
    )
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"
}

/**
 * The kept clips as a CMX 3600 edit decision list, which Premiere Pro, DaVinci
 * Resolve, Avid and most editors import as a timeline. The record side starts
 * at 01:00:00:00 and the source is assumed to start at 00:00:00:00.
 */
export function editsEdl(data: EditExport) {
  const { name, fps = 30 } = data
  const { segments, sourceAt } = exportTimeline(data)
  const title = name.replace(/\.[^.]+$/, "").replace(/[^\w -]/g, " ").trim()
  const lines = [
    `TITLE: ${title || "Untitled"}`,
    "FCM: NON-DROP FRAME",
    "",
  ]
  let elapsed = 0
  segments.forEach((segment, i) => {
    const source = sourceAt(segment.start)
    const length = segment.end - segment.start
    lines.push(
      [
        String(i + 1).padStart(3, "0"),
        " AX      ",
        " V    ",
        " C       ",
        ` ${timecode(segment.start - source.start, fps)}`,
        ` ${timecode(segment.end - source.start, fps)}`,
        ` ${timecode(elapsed, fps, 1)}`,
        ` ${timecode(elapsed + length, fps, 1)}`,
      ].join(""),
      `* FROM CLIP NAME: ${source.name}`,
      ""
    )
    elapsed += length
  })
  return lines.join("\r\n")
}

/**
 * The on-screen text as SubRip subtitles, timed against the edited clip (after
 * the cuts), so it lines up with a timeline made from the EDL.
 */
export function editsSrt(data: EditExport) {
  const { edits } = data
  const { segments, duration } = exportTimeline(data)
  const captions = tidyEdits(edits, duration)
    .flatMap((edit) =>
      edit.kind === "text" && edit.text.trim()
        ? recordRanges(edit, segments).map((range) => ({
            ...range,
            text: edit.text.trim(),
          }))
        : []
    )
    .sort((a, b) => a.start - b.start)
  return captions
    .map(
      (caption, i) =>
        `${i + 1}\r\n${srtTime(caption.start)} --> ${srtTime(caption.end)}\r\n${caption.text}\r\n`
    )
    .join("\r\n")
}

/** Timed comments on audio (or video) as a spreadsheet. */
export function marksCsv(name: string, marks: Mark[]) {
  const rows = [
    ["time", "seconds", "comment", "file"],
    ...[...marks]
      .sort((a, b) => a.at - b.at)
      .map((mark) => [clock(mark.at), seconds(mark.at), mark.text, name]),
  ]
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"
}
