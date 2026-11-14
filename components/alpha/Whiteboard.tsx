"use client"

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type Dispatch,
  type SetStateAction,
} from "react"
import type { Stroke, WhiteboardObject, Task } from "@/lib/alpha"
import { resolveArrow, objectAt, PEN_WIDTHS } from "@/lib/alpha"
import BoardObject from "./BoardObject"
import BoardIcon, { type BoardIconName } from "./BoardIcon"
import styles from "./whiteboard.module.css"

const CREATE: [WhiteboardObject["kind"], string, string][] = [
  ["sticky", "Sticky", "Add a sticky note"],
  ["text", "Text", "Add free text"],
  ["document", "Document", "Add a document"],
  ["kanban", "Kanban", "Add the task board"],
  ["arrow", "Arrow", "Add an arrow. Drop its ends on items to connect them"],
  ["link", "Ticket", "Add a ticket link. Clicking it opens the ticket beside the canvas"],
]

export default function Whiteboard({
  strokes,
  notes,
  color,
  palette,
  penWidth,
  onPen,
  onPaletteAdd,
  onPaletteRemove,
  onStroke,
  onUndo,
  onNotes,
  onTask,
  objects,
  tasks,
  columns,
  onObjectChange,
  onObjectDelete,
  onObjectAdd,
  onBoardTask,
  onTaskChange,
  onLinkTicket,
  onOpenTask,
  camera,
  setCamera,
  onSize,
}: {
  strokes: Stroke[]
  notes: string
  /** Current pen color. */
  color: string
  /** Saved pen colors. */
  palette: string[]
  penWidth: number
  onPen: (pen: { color?: string; width?: number }) => void
  onPaletteAdd: (color: string) => void
  onPaletteRemove: (color: string) => void
  onStroke: (stroke: Stroke) => void
  onUndo: () => void
  onNotes: (notes: string) => void
  onTask: (text: string) => void
  objects: WhiteboardObject[]
  tasks: Task[]
  columns: string[]
  onObjectChange: (id: string, patch: Partial<WhiteboardObject>) => void
  onObjectDelete: (id: string) => void
  onObjectAdd: (kind: WhiteboardObject["kind"]) => void
  onBoardTask: (title: string, column: string) => void
  onTaskChange: (id: string, patch: Partial<Task>) => void
  onLinkTicket: (objectId: string) => void
  onOpenTask: (id: string) => void
  camera: { x: number; y: number; zoom: number }
  setCamera: Dispatch<SetStateAction<{ x: number; y: number; zoom: number }>>
  onSize: (size: { width: number; height: number }) => void
}) {
  const [tool, setTool] = useState<"pen" | "hand">("pen")
  const [connectTarget, setConnectTarget] = useState<string | null>(null)
  const [draft, setDraft] = useState<[number, number][]>([])
  const [notesOpen, setNotesOpen] = useState(false)
  const [selection, setSelection] = useState("")
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!svg.current) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      onSize({ width, height })
    })
    observer.observe(svg.current)
    return () => observer.disconnect()
  }, [onSize])
  const gesture = useRef<{
    pointer: number
    kind: "pen" | "hand"
    x: number
    y: number
    camera: typeof camera
    points: [number, number][]
  } | null>(null)

  useEffect(() => {
    const surface = svg.current
    if (!surface) return
    const wheel = (event: WheelEvent) => {
      // Text and board contents retain their own scrolling.
      if (
        event.target instanceof Element &&
        event.target.closest("foreignObject")
      )
        return
      event.preventDefault()
      if (gesture.current) return
      const rect = surface.getBoundingClientRect()
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      setCamera((c) => {
        const zoom = Math.max(
          0.1,
          Math.min(4, c.zoom * Math.exp(-delta * 0.0015))
        )
        return {
          zoom,
          x: x - ((x - c.x) * zoom) / c.zoom,
          y: y - ((y - c.y) * zoom) / c.zoom,
        }
      })
    }
    surface.addEventListener("wheel", wheel, { passive: false })
    return () => surface.removeEventListener("wheel", wheel)
  }, [setCamera])

  function point(e: PointerEvent<SVGSVGElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect()
    return [
      (e.clientX - rect.left - camera.x) / camera.zoom,
      (e.clientY - rect.top - camera.y) / camera.zoom,
    ]
  }
  function zoomTo(value: number) {
    const rect = svg.current?.getBoundingClientRect()
    if (!rect) return
    const zoom = Math.min(4, Math.max(0.1, value))
    setCamera((c) => ({
      x: rect.width / 2 - ((rect.width / 2 - c.x) * zoom) / c.zoom,
      y: rect.height / 2 - ((rect.height / 2 - c.y) * zoom) / c.zoom,
      zoom,
    }))
  }
  function fit() {
    const rect = svg.current?.getBoundingClientRect()
    if (!rect || (!strokes.length && !objects.length)) {
      setCamera({ x: 0, y: 0, zoom: 1 })
      return
    }
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity
    for (const stroke of strokes)
      for (const [x, y] of stroke.points) {
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    for (const raw of objects) {
      const o = resolveArrow(raw, objects)
      left = Math.min(left, o.x, o.x + o.width)
      right = Math.max(right, o.x, o.x + o.width)
      top = Math.min(top, o.y, o.y + o.height)
      bottom = Math.max(bottom, o.y, o.y + o.height)
    }
    if (!Number.isFinite(left)) return
    const zoom = Math.max(
      0.1,
      Math.min(
        4,
        // Leave room for the tool rail on the left and the pen bar on top.
        (rect.width - 300) / Math.max(1, right - left),
        (rect.height - 180) / Math.max(1, bottom - top)
      )
    )
    setCamera({
      zoom,
      x: rect.width / 2 + 55 - ((left + right) / 2) * zoom,
      y: rect.height / 2 + 20 - ((top + bottom) / 2) * zoom,
    })
  }

  const saved = palette.includes(color.toLowerCase())
  const target = objects.find((o) => o.id === connectTarget)
  const toolButton = (
    name: "pen" | "hand",
    icon: BoardIconName,
    label: string,
    title: string
  ) => (
    <button
      aria-pressed={tool === name}
      onClick={() => setTool(name)}
      title={title}
    >
      <BoardIcon name={icon} /> <span>{label}</span>
    </button>
  )

  return (
    <section className={styles.whiteboard} aria-label="Whiteboard">
      <svg
        ref={svg}
        className={styles.surface}
        style={{
          cursor: tool === "hand" ? "grab" : "crosshair",
          backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
        aria-label="Drawing surface. Use the pen to draw or the hand to pan."
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (gesture.current || (e.button !== 0 && e.button !== 1)) return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          const kind = e.button === 1 ? "hand" : tool
          const points = kind === "pen" ? [point(e)] : []
          gesture.current = {
            pointer: e.pointerId,
            kind,
            x: e.clientX,
            y: e.clientY,
            camera,
            points,
          }
          setDraft(points)
        }}
        onPointerMove={(e) => {
          const g = gesture.current
          if (!g || g.pointer !== e.pointerId) return
          if (g.kind === "hand")
            setCamera({
              ...g.camera,
              x: g.camera.x + e.clientX - g.x,
              y: g.camera.y + e.clientY - g.y,
            })
          else {
            g.points.push(point(e))
            setDraft([...g.points])
          }
        }}
        onPointerUp={(e) => {
          const g = gesture.current
          if (!g || g.pointer !== e.pointerId) return
          if (g.kind === "pen") {
            g.points.push(point(e))
            onStroke({
              id: crypto.randomUUID(),
              color,
              width: penWidth,
              points: g.points,
            })
          }
          gesture.current = null
          setDraft([])
        }}
        onPointerCancel={() => {
          gesture.current = null
          setDraft([])
        }}
      >
        <g
          transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}
        >
          {strokes.map((s) => (
            <polyline
              key={s.id}
              points={s.points.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          <polyline
            points={draft.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={penWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {objects.map((item) => (
            <BoardObject
              key={item.id}
              item={resolveArrow(item, objects)}
              zoom={camera.zoom}
              tasks={tasks}
              columns={columns}
              onChange={(patch) => onObjectChange(item.id, patch)}
              onDelete={() => onObjectDelete(item.id)}
              onTask={onBoardTask}
              onTaskChange={onTaskChange}
              findTarget={(at, exclude) =>
                objectAt(objects, at, exclude, 12 / camera.zoom)
              }
              onConnectHover={setConnectTarget}
              onLinkTicket={() => onLinkTicket(item.id)}
              onOpenTask={onOpenTask}
            />
          ))}
          {target && (
            // Shown only while an arrow end is dragged over an item.
            <rect
              className={styles.connectTarget}
              x={target.x - 6 / camera.zoom}
              y={target.y - 6 / camera.zoom}
              width={target.width + 12 / camera.zoom}
              height={target.height + 12 / camera.zoom}
              strokeWidth={2 / camera.zoom}
              strokeDasharray={`${6 / camera.zoom} ${4 / camera.zoom}`}
            />
          )}
        </g>
      </svg>
      <div
        className={`${styles.hud} ${styles.tools}`}
        role="toolbar"
        aria-label="Whiteboard tools"
        aria-orientation="vertical"
      >
        {toolButton("pen", "pen", "Pen", "Draw with the pen")}
        {toolButton("hand", "hand", "Pan", "Drag to move around the whiteboard")}
        <button
          disabled={!strokes.length}
          onClick={onUndo}
          title="Undo the last stroke"
        >
          <BoardIcon name="undo" /> <span>Undo</span>
        </button>
        <button
          aria-expanded={notesOpen}
          onClick={() => setNotesOpen(!notesOpen)}
          title="Canvas notes"
        >
          <BoardIcon name="document" /> <span>Notes</span>
        </button>
        <div className={styles.toolDivider} />
        <span className={styles.toolCaption}>ADD</span>
        {CREATE.map(([kind, label, title]) => (
          <button
            key={kind}
            title={title}
            aria-label={title}
            onClick={() => onObjectAdd(kind)}
          >
            <BoardIcon name={kind} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {tool === "pen" && (
        <div
          className={`${styles.hud} ${styles.pen}`}
          role="toolbar"
          aria-label="Pen color and thickness"
        >
          <div className={styles.swatches} role="group" aria-label="Saved colors">
            {palette.map((c) => (
              <button
                key={c}
                title={`Use ${c}`}
                aria-label={`Pen color ${c}`}
                aria-pressed={c === color.toLowerCase()}
                style={{ "--swatch": c } as CSSProperties}
                onClick={() => onPen({ color: c })}
              />
            ))}
            <input
              type="color"
              title="Pick any color"
              aria-label="Pick a pen color"
              value={color}
              onChange={(e) => onPen({ color: e.target.value })}
            />
          </div>
          <button
            className={styles.penAction}
            title={
              saved
                ? "Remove this color from your saved colors"
                : "Save this color to your palette"
            }
            onClick={() =>
              saved ? onPaletteRemove(color) : onPaletteAdd(color)
            }
          >
            {saved ? "− Remove" : "+ Save"}
          </button>
          <div className={styles.penDivider} />
          <div
            className={styles.widths}
            role="group"
            aria-label="Pen thickness"
          >
            {PEN_WIDTHS.map((width) => (
              <button
                key={width}
                title={`${width} px`}
                aria-label={`Pen thickness ${width} pixels`}
                aria-pressed={penWidth === width}
                onClick={() => onPen({ width })}
              >
                <span
                  style={{
                    width: Math.min(width + 2, 16),
                    height: Math.min(width + 2, 16),
                    background: color,
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      )}
      {notesOpen && (
        <aside
          className={`${styles.hud} ${styles.notes}`}
          aria-label="Canvas notes"
        >
          <div>
            <strong>Canvas notes</strong>
            <button
              aria-label="Close notes"
              onClick={() => setNotesOpen(false)}
            >
              <BoardIcon name="close" size={14} />
            </button>
          </div>
          <textarea
            aria-label="Canvas notes"
            value={notes}
            onChange={(e) => {
              onNotes(e.target.value)
              setSelection("")
            }}
            placeholder="Capture an idea. Select text to turn it into a task."
            onSelect={(e) => {
              const el = e.currentTarget
              setSelection(
                el.value.slice(el.selectionStart, el.selectionEnd).trim()
              )
            }}
          />
          <button disabled={!selection} onClick={() => onTask(selection)}>
            Selection → task
          </button>
        </aside>
      )}
      <div
        className={`${styles.hud} ${styles.zoom}`}
        role="group"
        aria-label="Canvas zoom"
      >
        <button
          aria-label="Zoom out"
          disabled={camera.zoom <= 0.1}
          onClick={() => zoomTo(camera.zoom / 1.25)}
        >
          −
        </button>
        <button title="Reset zoom to 100%" onClick={() => zoomTo(1)}>
          {Math.round(camera.zoom * 100)}%
        </button>
        <button
          aria-label="Zoom in"
          disabled={camera.zoom >= 4}
          onClick={() => zoomTo(camera.zoom * 1.25)}
        >
          +
        </button>
        <button onClick={fit}>Fit</button>
      </div>
      <div className={styles.hint}>
        {connectTarget
          ? "Release to connect"
          : tool === "pen"
            ? "Drag to draw"
            : "Drag to pan"}{" "}
        · Drop an arrow end on an item to connect · Ctrl+Y terminal
      </div>
    </section>
  )
}
