"use client"

// The PDF preview: every page of a PDF in one vertical scroll, drawn with
// pdf.js. Pages are drawn as they come near the viewport and dropped again
// when they are far away, so a long document opens quickly and only a few
// canvases exist at a time. Replacing the PDF keeps the reader's place: the
// new pages that will be on screen are drawn first, then swapped in at the
// same page and offset, so nothing flashes. Text can be selected and copied,
// and links work.
import { useEffect, useRef, useState, type ReactNode } from "react"
import type {
  PageViewport,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PDFWorker,
  RenderTask,
  TextLayer,
} from "pdfjs-dist"
import styles from "./pdf-view.module.css"

type Props = {
  /** The PDF's bytes; null shows `empty`. A new array replaces what is shown. */
  data: Uint8Array | null
  /** Shown instead of pages when there is no PDF yet. */
  empty?: ReactNode
  /** A compile is running: show a quiet indicator but keep the previous pages visible. */
  busy?: boolean
  /** File name for the download button, e.g. "resume.pdf". */
  name?: string
}

type Pdfjs = typeof import("pdfjs-dist")
type Engine = { pdfjs: Pdfjs; worker: Worker; port: PDFWorker }

/** CSS pixels per PDF point: a scale of this is "100%". */
const ACTUAL = 96 / 72
const ZOOMS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
  5,
]
const MIN_SCALE = ZOOMS[0] * ACTUAL
const MAX_SCALE = ZOOMS[ZOOMS.length - 1] * ACTUAL
/** Space around and between pages, matching pdf-view.module.css. */
const PAD = 16
const GAP = 12
/** The most pixels one page's canvas may hold (beyond this, it draws less sharply). */
const MAX_CANVAS_PIXELS = 4096 * 4096

const clampScale = (scale: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/**
 * Loads pdf.js and starts its worker. The worker is bundled from the package
 * by `new URL(…, import.meta.url)`, which Turbopack and webpack both follow,
 * so it is served from this app, never a CDN. Each viewer has its own worker
 * and ends it when it goes away.
 */
async function startEngine(): Promise<Engine> {
  const pdfjs = await import("pdfjs-dist")
  const worker = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
    { type: "module" }
  )
  const port = pdfjs.PDFWorker.create({
    port: worker,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  })
  return { pdfjs, worker, port }
}

export type ViewState = {
  /** The page being read, from 1. */
  page: number
  count: number
  /** CSS pixels per PDF point. */
  scale: number
  fit: boolean
}
type Status =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string }

/** One page's place in the scroll, and what is drawn in it. */
type Slot = {
  index: number
  /** The page at scale 1 (PDF points). */
  base: PageViewport
  el: HTMLDivElement
  canvas: HTMLCanvasElement | null
  /** The scale `canvas` was drawn at. */
  drawnScale: number
  /** The scale being drawn now, or 0. */
  drawing: number
  pending: Promise<void> | null
  task: RenderTask | null
  text: TextLayer | null
  textEl: HTMLDivElement | null
  linked: boolean
}
/** A loaded document and its pages. */
type Generation = { doc: PDFDocumentProxy; slots: Slot[]; dead: boolean }
/** Where the reader is: a page, how far down it, and the sideways scroll. */
type Anchor = { index: number; fraction: number; left: number }

function freeCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return
  // Zero-sized canvases give their memory back straight away.
  canvas.width = 0
  canvas.height = 0
  canvas.remove()
}

/** Runs the pages imperatively; the component renders the toolbar around it. */
class Viewer {
  private engine: Promise<Engine> | null = null
  private pdfjs: Pdfjs | null = null
  private shown: Generation | null = null
  private incoming: Generation | null = null
  private loadingTask: PDFDocumentLoadingTask | null = null
  private ticket = 0
  private destroyed = false
  private scale = ACTUAL
  private fit = true
  private page = 1
  private slotOf = new WeakMap<Element, Slot>()
  private near: IntersectionObserver
  private far: IntersectionObserver
  private resize: ResizeObserver
  private redrawTimer = 0
  private scrollFrame = 0
  private resizeFrame = 0

  constructor(
    private scroller: HTMLDivElement,
    private pages: HTMLDivElement,
    private report: (view: ViewState) => void,
    private status: (status: Status) => void
  ) {
    // Pages within a screen of the viewport are drawn; pages more than three
    // screens away are dropped.
    this.near = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slot = this.slotOf.get(entry.target)
          if (slot && entry.isIntersecting && this.shown)
            void this.draw(this.shown, slot)
        }
      },
      { root: scroller, rootMargin: "100% 0px" }
    )
    this.far = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slot = this.slotOf.get(entry.target)
          if (slot && !entry.isIntersecting) this.release(slot)
        }
      },
      { root: scroller, rootMargin: "300% 0px" }
    )
    this.resize = new ResizeObserver(() => {
      cancelAnimationFrame(this.resizeFrame)
      this.resizeFrame = requestAnimationFrame(() => {
        if (this.fit && this.shown)
          this.setScale(this.fitScale(this.shown), { x: 0, y: 0 })
      })
    })
    this.resize.observe(scroller)
    scroller.addEventListener("scroll", this.onScroll, { passive: true })
    scroller.addEventListener("wheel", this.onWheel, { passive: false })
  }

  // ---- Loading ----

  async load(data: Uint8Array | null) {
    const ticket = ++this.ticket
    this.loadingTask?.destroy()
    this.loadingTask = null
    if (this.incoming) this.kill(this.incoming)
    this.incoming = null
    if (!data) {
      this.clear()
      this.status({ kind: "empty" })
      return
    }
    if (!this.shown) this.status({ kind: "loading" })
    const stale = () => ticket !== this.ticket || this.destroyed
    let doc: PDFDocumentProxy | null = null
    try {
      const engine = await (this.engine ??= startEngine())
      if (stale()) return
      this.pdfjs = engine.pdfjs
      // pdf.js takes the buffer it is given away to its worker: give it a copy.
      const task = engine.pdfjs.getDocument({
        data: data.slice(),
        worker: engine.port,
        verbosity: engine.pdfjs.VerbosityLevel.ERRORS,
      })
      this.loadingTask = task
      doc = await task.promise
      if (stale()) {
        void doc.loadingTask.destroy()
        return
      }
      this.loadingTask = null
      const loaded = doc
      const bases = await Promise.all(
        Array.from({ length: loaded.numPages }, (_, i) =>
          loaded.getPage(i + 1).then((page) => page.getViewport({ scale: 1 }))
        )
      )
      if (stale()) {
        void doc.loadingTask.destroy()
        return
      }
      const generation: Generation = {
        doc,
        slots: bases.map((base, index) => this.makeSlot(base, index)),
        dead: false,
      }
      this.incoming = generation
      // Draw the pages that will be on screen before showing them.
      const anchor = this.shown ? this.anchorAt(0) : null
      const scale = this.fit ? this.fitScale(generation) : this.scale
      this.size(generation, scale)
      const visible = this.predict(generation, anchor)
      await Promise.all(
        visible.map((slot) => this.draw(generation, slot, scale))
      )
      if (stale() || generation.dead) return
      this.swap(generation, anchor)
    } catch (error) {
      if (stale()) return
      void doc?.loadingTask.destroy()
      this.incoming = null
      this.clear()
      this.status({ kind: "error", message: describe(error) })
    }
  }

  private makeSlot(base: PageViewport, index: number): Slot {
    const el = document.createElement("div")
    el.className = styles.page
    el.dataset.page = String(index + 1)
    const slot: Slot = {
      index,
      base,
      el,
      canvas: null,
      drawnScale: 0,
      drawing: 0,
      pending: null,
      task: null,
      text: null,
      textEl: null,
      linked: false,
    }
    this.slotOf.set(el, slot)
    return slot
  }

  /** The pages of a new document that will be on screen at `anchor`. */
  private predict(generation: Generation, anchor: Anchor | null) {
    const { slots } = generation
    const index = anchor ? Math.min(anchor.index, slots.length - 1) : 0
    const heights = slots.map((slot) => parseFloat(slot.el.style.height))
    let top = PAD
    for (let i = 0; i < index; i++) top += heights[i] + GAP
    const start = top + (anchor ? anchor.fraction * heights[index] : 0)
    const end = start + this.scroller.clientHeight
    const visible: Slot[] = []
    for (let i = index, y = top; i < slots.length && y < end; i++) {
      if (y + heights[i] > start - GAP) visible.push(slots[i])
      y += heights[i] + GAP
    }
    return visible
  }

  /** Shows a loaded document in place of the current one. */
  private swap(generation: Generation, anchor: Anchor | null) {
    const old = this.shown
    this.shown = generation
    this.incoming = null
    // The scale may have changed while the new pages were drawn.
    if (this.fit) this.scale = this.fitScale(generation)
    this.size(generation, this.scale)
    this.pages.replaceChildren(...generation.slots.map((slot) => slot.el))
    if (old) this.kill(old)
    for (const slot of generation.slots) {
      this.near.observe(slot.el)
      this.far.observe(slot.el)
    }
    if (anchor) this.restore(anchor, 0)
    else this.scroller.scrollTo({ top: 0, left: 0 })
    this.status({ kind: "ready" })
    this.findPage()
    this.emit()
    this.scheduleRedraw()
  }

  /** Stops drawing a document and lets it go. */
  private kill(generation: Generation) {
    generation.dead = true
    for (const slot of generation.slots) {
      this.near.unobserve(slot.el)
      this.far.unobserve(slot.el)
      this.release(slot)
    }
    void generation.doc.loadingTask.destroy().catch(() => {})
  }

  private clear() {
    if (this.shown) this.kill(this.shown)
    this.shown = null
    this.pages.replaceChildren()
    this.page = 1
    this.emit()
  }

  // ---- Drawing ----

  /** Draws a page at a scale (by default the current one), once. */
  private draw(
    generation: Generation,
    slot: Slot,
    scale = this.scale
  ): Promise<void> {
    if (generation.dead) return Promise.resolve()
    if (slot.canvas && slot.drawnScale === scale) return Promise.resolve()
    if (slot.drawing === scale && slot.pending) return slot.pending
    slot.task?.cancel()
    slot.drawing = scale
    const run = async () => {
      let canvas: HTMLCanvasElement | null = null
      try {
        const page = await generation.doc.getPage(slot.index + 1)
        if (generation.dead || slot.drawing !== scale) return
        const viewport = page.getViewport({ scale })
        // Sharp at the device's pixel ratio, within a memory budget.
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height))
        )
        canvas = document.createElement("canvas")
        canvas.className = styles.canvas
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
        const task = page.render({
          canvas,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        })
        slot.task = task
        try {
          await task.promise
        } finally {
          if (slot.task === task) slot.task = null
        }
        if (generation.dead || slot.drawing !== scale) {
          freeCanvas(canvas)
          return
        }
        slot.drawing = 0
        // The old drawing stays up (stretched) until this one is ready.
        freeCanvas(slot.canvas)
        slot.el.prepend(canvas)
        slot.canvas = canvas
        slot.drawnScale = scale
        if (!slot.textEl) this.addText(generation, slot, page, viewport)
        if (!slot.linked) void this.addLinks(generation, slot, page)
      } catch (error) {
        freeCanvas(canvas)
        if (slot.drawing === scale) slot.drawing = 0
        if (!generation.dead && !isCancel(error))
          console.warn("PDF page could not be drawn", error)
      }
    }
    slot.pending = run()
    return slot.pending
  }

  /** The invisible, selectable text over a page. */
  private addText(
    generation: Generation,
    slot: Slot,
    page: PDFPageProxy,
    viewport: PageViewport
  ) {
    if (!this.pdfjs) return
    const el = document.createElement("div")
    el.className = styles.textLayer
    const text = new this.pdfjs.TextLayer({
      textContentSource: page.streamTextContent({
        includeMarkedContent: true,
        disableNormalization: true,
      }),
      container: el,
      viewport,
    })
    slot.text = text
    slot.textEl = el
    slot.el.append(el)
    text.render().then(
      () => {
        // Lets a selection drag past the last line without jumping.
        const end = document.createElement("div")
        end.className = "endOfContent"
        el.append(end)
      },
      (error: unknown) => {
        if (!generation.dead && !isCancel(error))
          console.warn("PDF text could not be laid out", error)
      }
    )
  }

  /** Links: web links open in a new tab, links within the PDF scroll to their place. */
  private async addLinks(
    generation: Generation,
    slot: Slot,
    page: PDFPageProxy
  ) {
    slot.linked = true
    let annotations: Array<Record<string, unknown>>
    try {
      annotations = await page.getAnnotations({ intent: "display" })
    } catch {
      return
    }
    if (generation.dead) return
    const layer = document.createElement("div")
    layer.className = styles.links
    const { width, height } = slot.base
    for (const annotation of annotations) {
      if (annotation.subtype !== "Link" || !Array.isArray(annotation.rect))
        continue
      const rect = annotation.rect as number[]
      const [x1, y1] = slot.base.convertToViewportPoint(rect[0], rect[1])
      const [x2, y2] = slot.base.convertToViewportPoint(rect[2], rect[3])
      const link = document.createElement("a")
      link.style.left = `${(Math.min(x1, x2) / width) * 100}%`
      link.style.top = `${(Math.min(y1, y2) / height) * 100}%`
      link.style.width = `${(Math.abs(x2 - x1) / width) * 100}%`
      link.style.height = `${(Math.abs(y2 - y1) / height) * 100}%`
      if (typeof annotation.url === "string") {
        link.href = annotation.url
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        link.title = annotation.url
      } else if (annotation.dest) {
        const dest = annotation.dest
        link.href = "#"
        link.title = "Go to the linked place"
        link.addEventListener("click", (event) => {
          event.preventDefault()
          void this.goToDestination(generation, dest)
        })
      } else continue
      layer.append(link)
    }
    if (layer.childElementCount) slot.el.append(layer)
  }

  /** Lets go of a page's drawing and text (its links stay). */
  private release(slot: Slot) {
    slot.task?.cancel()
    slot.task = null
    slot.drawing = 0
    slot.pending = null
    freeCanvas(slot.canvas)
    slot.canvas = null
    slot.drawnScale = 0
    slot.text?.cancel()
    slot.text = null
    slot.textEl?.remove()
    slot.textEl = null
  }

  /** Redraws the pages near the viewport at the current scale, once zooming settles. */
  private scheduleRedraw() {
    clearTimeout(this.redrawTimer)
    this.redrawTimer = window.setTimeout(() => {
      const shown = this.shown
      if (!shown) return
      const top = this.scroller.scrollTop - this.scroller.clientHeight
      const bottom = top + this.scroller.clientHeight * 3
      for (const slot of shown.slots) {
        const y = slot.el.offsetTop
        if (y + slot.el.offsetHeight > top && y < bottom)
          void this.draw(shown, slot)
      }
    }, 140)
  }

  // ---- Size and place ----

  private size(generation: Generation, scale: number) {
    for (const slot of generation.slots) {
      const { style } = slot.el
      style.width = `${Math.floor(slot.base.width * scale)}px`
      style.height = `${Math.floor(slot.base.height * scale)}px`
      style.setProperty("--total-scale-factor", String(scale))
    }
  }

  private fitScale(generation: Generation) {
    const width = this.scroller.clientWidth - PAD * 2
    const widest = Math.max(...generation.slots.map((slot) => slot.base.width))
    if (width <= 0 || !widest) return this.scale
    return clampScale(width / widest)
  }

  /** The last page starting at or above `y` (in scroll coordinates). */
  private slotAt(y: number) {
    const slots = this.shown?.slots ?? []
    let low = 0
    let high = slots.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (slots[middle].el.offsetTop <= y) low = middle
      else high = middle - 1
    }
    return slots[low]
  }

  /** Where the reader is, measured `offset` pixels below the top of the view. */
  private anchorAt(offset: number): Anchor | null {
    const y = this.scroller.scrollTop + offset
    const slot = this.slotAt(y)
    if (!slot) return null
    return {
      index: slot.index,
      fraction: (y - slot.el.offsetTop) / slot.el.offsetHeight,
      left: this.scroller.scrollLeft,
    }
  }

  private restore(anchor: Anchor, offset: number) {
    const slots = this.shown?.slots ?? []
    const slot = slots[Math.min(anchor.index, slots.length - 1)]
    if (!slot) return
    this.scroller.scrollTop =
      slot.el.offsetTop + anchor.fraction * slot.el.offsetHeight - offset
    this.scroller.scrollLeft = anchor.left
  }

  /** Zooms, keeping the point at `focus` (relative to the view) in place. */
  private setScale(scale: number, focus?: { x: number; y: number }) {
    scale = clampScale(scale)
    const shown = this.shown
    if (!shown || Math.abs(scale - this.scale) < 1e-4) {
      this.scale = scale
      this.emit()
      return
    }
    const point = focus ?? {
      x: this.scroller.clientWidth / 2,
      y: this.scroller.clientHeight / 2,
    }
    const anchor = this.anchorAt(point.y)
    const across = this.scroller.scrollLeft + point.x
    const ratio = scale / this.scale
    this.scale = scale
    this.size(shown, scale)
    if (anchor) this.restore({ ...anchor, left: 0 }, point.y)
    this.scroller.scrollLeft = across * ratio - point.x
    this.findPage()
    this.emit()
    this.scheduleRedraw()
  }

  zoomStep(direction: 1 | -1) {
    const zoom = this.scale / ACTUAL
    const next =
      direction > 0
        ? (ZOOMS.find((step) => step > zoom * 1.05) ?? ZOOMS.at(-1)!)
        : (ZOOMS.findLast((step) => step < zoom / 1.05) ?? ZOOMS[0])
    this.fit = false
    this.setScale(next * ACTUAL)
  }

  setFit(fit: boolean) {
    this.fit = fit
    if (fit && this.shown)
      this.setScale(this.fitScale(this.shown), { x: 0, y: 0 })
    else this.emit()
  }

  goToPage(page: number) {
    const slots = this.shown?.slots
    if (!slots?.length) return
    const slot = slots[Math.min(Math.max(1, page), slots.length) - 1]
    this.scroller.scrollTop = slot.el.offsetTop - PAD / 2
    this.page = slot.index + 1
    this.emit()
  }

  private async goToDestination(generation: Generation, dest: unknown) {
    try {
      const explicit =
        typeof dest === "string"
          ? await generation.doc.getDestination(dest)
          : dest
      if (!Array.isArray(explicit) || generation !== this.shown) return
      const [ref, mode] = explicit as [unknown, { name?: string } | null]
      const index =
        typeof ref === "number"
          ? ref
          : await generation.doc.getPageIndex(
              ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]
            )
      const slot = generation.slots[index]
      if (!slot || generation !== this.shown) return
      let left: unknown = null
      let top: unknown = null
      if (mode?.name === "XYZ") [left, top] = [explicit[2], explicit[3]]
      else if (mode?.name === "FitH" || mode?.name === "FitBH")
        top = explicit[2]
      else if (mode?.name === "FitR") [left, top] = [explicit[2], explicit[5]]
      let y = 0
      if (typeof top === "number") {
        const [, point] = slot.base.convertToViewportPoint(
          typeof left === "number" ? left : 0,
          top
        )
        y = Math.max(0, point * this.scale)
      }
      this.scroller.scrollTop = slot.el.offsetTop + y - PAD / 2
    } catch {
      // A broken link goes nowhere.
    }
  }

  /** Works out which page is being read. */
  private findPage() {
    const { scrollTop, clientHeight, scrollHeight } = this.scroller
    const slots = this.shown?.slots
    if (!slots?.length) return
    const atEnd = scrollTop + clientHeight >= scrollHeight - 2
    const slot = atEnd
      ? slots[slots.length - 1]
      : this.slotAt(scrollTop + Math.min(clientHeight / 3, 160))
    if (slot.index + 1 !== this.page) {
      this.page = slot.index + 1
      this.emit()
    }
  }

  private onScroll = () => {
    cancelAnimationFrame(this.scrollFrame)
    this.scrollFrame = requestAnimationFrame(() => this.findPage())
  }

  private onWheel = (event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    if (!this.shown) return
    const box = this.scroller.getBoundingClientRect()
    const step = event.deltaMode === 1 ? 0.05 : 0.0025
    this.fit = false
    this.setScale(this.scale * Math.exp(-event.deltaY * step), {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    })
  }

  private emit() {
    this.report({
      page: this.page,
      count: this.shown?.slots.length ?? 0,
      scale: this.scale,
      fit: this.fit,
    })
  }

  destroy() {
    this.destroyed = true
    this.ticket++
    this.loadingTask?.destroy()
    this.loadingTask = null
    if (this.incoming) this.kill(this.incoming)
    if (this.shown) this.kill(this.shown)
    this.incoming = this.shown = null
    this.near.disconnect()
    this.far.disconnect()
    this.resize.disconnect()
    clearTimeout(this.redrawTimer)
    cancelAnimationFrame(this.scrollFrame)
    cancelAnimationFrame(this.resizeFrame)
    this.scroller.removeEventListener("scroll", this.onScroll)
    this.scroller.removeEventListener("wheel", this.onWheel)
    this.pages.replaceChildren()
    void this.engine?.then(
      ({ port, worker }) => {
        port.destroy()
        worker.terminate()
      },
      () => {}
    )
  }
}

function isCancel(error: unknown) {
  const name = (error as { name?: string } | null)?.name
  return name === "RenderingCancelledException" || name === "AbortException"
}

function describe(error: unknown) {
  const name = (error as { name?: string } | null)?.name
  if (name === "PasswordException") return "This PDF is password-protected."
  if (name === "InvalidPDFException")
    return "The file is empty or is not a valid PDF."
  const message = (error as { message?: string } | null)?.message
  return message
    ? `The PDF could not be read (${message}).`
    : "The PDF could not be read."
}

export default function PdfView({
  data,
  empty,
  busy = false,
  name = "document.pdf",
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const pages = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const [view, setView] = useState<ViewState>({
    page: 1,
    count: 0,
    scale: ACTUAL,
    fit: true,
  })
  const [status, setStatus] = useState<Status>({ kind: "empty" })
  /** The page number being typed, or null when showing the current page. */
  const [draft, setDraft] = useState<string | null>(null)

  useEffect(() => {
    const instance = new Viewer(
      scroller.current!,
      pages.current!,
      (next) =>
        setView((current) =>
          current.page === next.page &&
          current.count === next.count &&
          current.scale === next.scale &&
          current.fit === next.fit
            ? current
            : next
        ),
      (next) =>
        setStatus((current) =>
          current.kind === next.kind &&
          (current.kind !== "error" ||
            (next.kind === "error" && current.message === next.message))
            ? current
            : next
        )
    )
    viewer.current = instance
    return () => {
      instance.destroy()
      viewer.current = null
    }
  }, [])

  useEffect(() => {
    void viewer.current?.load(data)
  }, [data])

  const ready = status.kind === "ready" && view.count > 0
  const goTo = () => {
    if (draft !== null) {
      const page = parseInt(draft, 10)
      if (Number.isFinite(page)) viewer.current?.goToPage(page)
    }
    setDraft(null)
  }
  const download = () => {
    if (!data) return
    const url = URL.createObjectURL(
      new Blob([data.slice()], { type: "application/pdf" })
    )
    const link = document.createElement("a")
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className={styles.viewer}>
      <div className={styles.bar} role="toolbar" aria-label="PDF preview">
        <button
          type="button"
          className={styles.tool}
          onClick={() => viewer.current?.zoomStep(-1)}
          disabled={!ready}
          aria-label="Zoom out"
          title="Zoom out (Ctrl + wheel)"
        >
          −
        </button>
        <span className={styles.zoom} aria-live="polite">
          {Math.round((view.scale / ACTUAL) * 100)}%
        </span>
        <button
          type="button"
          className={styles.tool}
          onClick={() => viewer.current?.zoomStep(1)}
          disabled={!ready}
          aria-label="Zoom in"
          title="Zoom in (Ctrl + wheel)"
        >
          +
        </button>
        <button
          type="button"
          className={styles.tool}
          onClick={() => viewer.current?.setFit(!view.fit)}
          aria-pressed={view.fit}
          disabled={!ready}
          title="Fit the page width to the pane"
        >
          Fit width
        </button>
        <span className={styles.spacer} />
        {busy && (
          <span className={styles.busyLabel} role="status">
            <i aria-hidden /> Compiling
          </span>
        )}
        <label className={styles.pageBox}>
          <input
            className={styles.pageInput}
            value={draft ?? (view.count ? String(view.page) : "–")}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.target.select()}
            onBlur={goTo}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                goTo()
              } else if (event.key === "Escape") {
                event.preventDefault()
                setDraft(null)
              }
            }}
            disabled={!ready}
            inputMode="numeric"
            aria-label="Page number"
            size={3}
          />
          <span>/ {view.count || "–"}</span>
        </label>
        <button
          type="button"
          className={styles.tool}
          onClick={download}
          disabled={!data}
          title={`Download ${name}`}
        >
          Download
        </button>
      </div>
      <div className={styles.stage}>
        {busy && <div className={styles.progress} aria-hidden />}
        <div ref={scroller} className={styles.scroll}>
          <div ref={pages} className={styles.pages} />
        </div>
        {status.kind === "empty" && (
          <div className={styles.message}>{empty ?? "No PDF yet."}</div>
        )}
        {status.kind === "loading" && (
          <div className={styles.message}>Opening the PDF…</div>
        )}
        {status.kind === "error" && (
          <div className={styles.message} role="alert">
            <strong>This PDF can’t be shown</strong>
            <span>{status.message}</span>
          </div>
        )}
      </div>
    </div>
  )
}
