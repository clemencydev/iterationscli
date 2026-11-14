"use client"

import { useEffect, useRef, useState, type PointerEvent, type Dispatch, type SetStateAction } from "react"
import type { Stroke, WhiteboardObject, Task } from "@/lib/alpha"
import { resolveArrow, connectionPoint, type Connection } from "@/lib/alpha"
import BoardObject from "./BoardObject"
import BoardIcon from "./BoardIcon"
import styles from "./whiteboard.module.css"

export default function Whiteboard({
  strokes,
  notes,
  color,
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
  camera, setCamera, onSize, onConnect,
}: {
  strokes: Stroke[]
  notes: string
  color: string
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
  camera: { x: number; y: number; zoom: number }
  setCamera: Dispatch<SetStateAction<{ x: number; y: number; zoom: number }>>
  onSize: (size: { width: number; height: number }) => void
  onConnect: (from: Connection, to: Connection) => void
}) {
  const [tool, setTool] = useState<"pen" | "hand">("pen")
  const [ink, setInk] = useState(color)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [draft, setDraft] = useState<[number, number][]>([])
  const [notesOpen, setNotesOpen] = useState(false)
  const [selection, setSelection] = useState("")
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!svg.current) return
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; onSize({ width, height }) })
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
        (rect.width - 140) / Math.max(1, right - left),
        (rect.height - 160) / Math.max(1, bottom - top)
      )
    )
    setCamera({
      zoom,
      x: rect.width / 2 - ((left + right) / 2) * zoom,
      y: rect.height / 2 - ((top + bottom) / 2) * zoom,
    })
  }

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
            onStroke({ id: crypto.randomUUID(), color: ink, points: g.points })
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
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          <polyline
            points={draft.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke={ink}
            strokeWidth="3"
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
            />
          ))}
          {objects.filter(o => o.kind !== "arrow").flatMap(o => (["top", "right", "bottom", "left"] as const).map(side => {
            const p = connectionPoint(o, side)
            const choose = () => {
              const next = { objectId: o.id, side }
              if (!connection) setConnection(next)
              else { if (connection.objectId !== o.id) onConnect(connection, next); setConnection(null) }
            }
            return <circle key={`${o.id}-${side}`} cx={p.x} cy={p.y} r={5 / camera.zoom} fill={connection?.objectId === o.id && connection.side === side ? "var(--primary)" : "var(--background)"} stroke="var(--primary)" strokeWidth={1.5 / camera.zoom} tabIndex={0} role="button" aria-label={`Connect ${o.kind} ${side}`} style={{ cursor: "crosshair" }} onPointerDown={e => e.stopPropagation()} onClick={choose} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose() } if (e.key === "Escape") setConnection(null) }} />
          }))}
        </g>
      </svg>
      <div className={`${styles.hud} ${styles.title}`}>
        <strong>Whiteboard</strong>
        <span>Personal canvas</span>
        <select
          aria-label="Add whiteboard object"
          value=""
          onChange={(e) =>
            onObjectAdd(e.target.value as WhiteboardObject["kind"])
          }
        >
          <option value="" disabled>
            + Add
          </option>
          <option value="sticky">Sticky note</option>
          <option value="kanban">Kanban</option>
          <option value="arrow">Arrow</option>
          <option value="document">Document</option>
        </select>
      </div>
      {connection && <div className={styles.connectionHint}>Click a dot on another item to connect.<button onClick={() => setConnection(null)}>Cancel</button></div>}
      <div
        className={`${styles.hud} ${styles.tools}`}
        role="toolbar"
        aria-label="Whiteboard tools"
      >
        <button
          aria-pressed={tool === "pen"}
          onClick={() => setTool("pen")}
          title="Draw with the pen"
        >
          <BoardIcon name="pen" /> <span>Pen</span>
        </button>
        <button
          aria-pressed={tool === "hand"}
          onClick={() => setTool("hand")}
          title="Drag to move around the whiteboard"
        >
          <BoardIcon name="hand" /> <span>Pan</span>
        </button>
        <label className={styles.ink} title="Pen color">
          <input
            aria-label="Pen color"
            type="color"
            value={ink}
            onChange={(e) => setInk(e.target.value)}
          />
        </label>
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
        >
          <BoardIcon name="document" /> <span>Notes</span>
        </button>
        <div className={styles.toolDivider} />
        <span className={styles.toolCaption}>CREATE</span>
        {(["sticky", "kanban", "arrow", "document"] as const).map((kind) => (
          <button
            key={kind}
            title={`Add ${kind === "sticky" ? "sticky note" : kind}`}
            aria-label={`Add ${kind}`}
            onClick={() => onObjectAdd(kind)}
          >
            <BoardIcon name={kind} />
            <span>
              {kind === "sticky"
                ? "Sticky"
                : kind === "kanban"
                  ? "Kanban"
                  : kind === "arrow"
                    ? "Arrow"
                    : "Document"}
            </span>
          </button>
        ))}
      </div>
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
              ×
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
        {tool === "pen" ? "Drag to draw" : "Drag to pan"} · Ctrl+Y terminal
      </div>
    </section>
  )
}
