"use client"
import { useRef, type PointerEvent } from "react"
import type { WhiteboardObject, Task } from "@/lib/alpha"
import styles from "./whiteboard.module.css"
import BoardIcon from "./BoardIcon"
import DocumentEditor from "./DocumentEditor"

export default function BoardObject({
  item,
  zoom,
  columns,
  tasks,
  onChange,
  onDelete,
  onTask,
  onTaskChange,
}: {
  item: WhiteboardObject
  zoom: number
  columns: string[]
  tasks: Task[]
  onChange: (patch: Partial<WhiteboardObject>) => void
  onDelete: () => void
  onTask: (title: string, column: string) => void
  onTaskChange: (id: string, patch: Partial<Task>) => void
}) {
  const drag = useRef<{
    x: number
    y: number
    original: WhiteboardObject
    kind: "move" | "resize" | "start" | "end"
  } | null>(null)
  function start(
    e: PointerEvent<Element>,
    kind: "move" | "resize" | "start" | "end"
  ) {
    if (e.button !== 0 || item.locked) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, original: item, kind }
  }
  function move(e: PointerEvent<Element>) {
    if (!drag.current || item.locked) return
    e.stopPropagation()
    const { original: o, kind } = drag.current
    const dx = (e.clientX - drag.current.x) / zoom,
      dy = (e.clientY - drag.current.y) / zoom
    if (kind === "move") onChange({ x: o.x + dx, y: o.y + dy, ...(o.kind === "arrow" ? { from: undefined, to: undefined } : {}) })
    if (kind === "resize")
      onChange({
        width: Math.max(220, o.width + dx),
        height: Math.max(170, o.height + dy),
      })
    if (kind === "end") onChange({ x: o.x, y: o.y, width: o.width + dx, height: o.height + dy, to: undefined })
    if (kind === "start")
      onChange({
        x: o.x + dx,
        y: o.y + dy,
        width: o.width - dx,
        height: o.height - dy,
        from: undefined,
      })
  }
  const events = {
    onPointerMove: move,
    onPointerUp: () => {
      drag.current = null
    },
    onPointerCancel: () => {
      drag.current = null
    },
  }
  const header = (
    <div className={styles.objectHeader}>
      <button
        className={styles.moveObject}
        disabled={!!item.locked}
        aria-label={`Move ${item.kind}`}
        title="Drag to move; arrow keys nudge"
        onPointerDown={(e) => start(e, "move")}
        {...events}
        onKeyDown={(e) => {
          if (item.locked) return
          const dx =
            e.key === "ArrowRight" ? 10 : e.key === "ArrowLeft" ? -10 : 0
          const dy = e.key === "ArrowDown" ? 10 : e.key === "ArrowUp" ? -10 : 0
          if (dx || dy) {
            e.preventDefault()
            onChange({ x: item.x + dx, y: item.y + dy })
          }
        }}
      >
        <BoardIcon name={item.kind === "sticky" ? "grip" : item.kind} />
        {item.kind !== "sticky" && (
          <span>{item.kind === "kanban" ? "Task board" : item.kind}</span>
        )}
      </button>
      {item.kind === "kanban" && (
        <button
          aria-label={
            item.locked ? "Unlock board position" : "Lock board position"
          }
          title={
            item.locked
              ? "Unlock to move and resize"
              : "Lock position (tasks remain editable)"
          }
          aria-pressed={!!item.locked}
          onClick={() => onChange({ locked: !item.locked })}
        >
          <BoardIcon name={item.locked ? "lock" : "unlock"} />
        </button>
      )}
      <button onClick={onDelete} aria-label={`Delete ${item.kind}`}>
        <BoardIcon name="delete" />
      </button>
    </div>
  )
  if (item.kind === "arrow") {
    const angle = Math.atan2(item.height, item.width),
      x2 = item.x + item.width,
      y2 = item.y + item.height
    const head = [0.5, -0.5].map(
      (a) => `${x2 - 16 * Math.cos(angle + a)},${y2 - 16 * Math.sin(angle + a)}`
    )
    return (
      <g
        className={styles.arrowObject}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <line
          x1={item.x}
          y1={item.y}
          x2={x2}
          y2={y2}
          stroke="transparent"
          strokeWidth="18"
          style={{ cursor: "move", touchAction: "none" }}
          onPointerDown={(e) => start(e, "move")}
          {...events}
        />
        <line
          x1={item.x}
          y1={item.y}
          x2={x2}
          y2={y2}
          stroke="var(--foreground)"
          strokeWidth="3"
          style={{ pointerEvents: "none" }}
        />
        <polyline
          points={`${head[0]} ${x2},${y2} ${head[1]}`}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="3"
        />
        {(["start", "end"] as const).map((end, i) => (
          <circle
            key={end}
            cx={i ? x2 : item.x}
            cy={i ? y2 : item.y}
            r={7}
            fill="var(--background)"
            stroke="var(--foreground)"
            strokeWidth="2"
            tabIndex={0}
            role="button"
            aria-label={`Move arrow ${end}`}
            style={{ cursor: "move", touchAction: "none" }}
            onPointerDown={(e) => start(e, end)}
            {...events}
            onKeyDown={(e) => {
              const dx =
                  e.key === "ArrowRight" ? 10 : e.key === "ArrowLeft" ? -10 : 0,
                dy = e.key === "ArrowDown" ? 10 : e.key === "ArrowUp" ? -10 : 0
              if (!dx && !dy) return
              e.preventDefault()
              onChange(
                end === "end"
                  ? { x: item.x, y: item.y, width: item.width + dx, height: item.height + dy, to: undefined }
                  : {
                      x: item.x + dx,
                      y: item.y + dy,
                      width: item.width - dx,
                      height: item.height - dy,
                      from: undefined,
                    }
              )
            }}
          />
        ))}
        <foreignObject
          x={(item.x + x2) / 2 - 100}
          y={(item.y + y2) / 2 - 40}
          width="200"
          height="38"
        >
          <div className={styles.arrowLabel}>
            <input
              aria-label="Arrow label"
              value={item.text}
              onChange={(e) => onChange({ text: e.target.value })}
              placeholder="Add label"
            />
            <button
              className={styles.arrowDelete}
              aria-label="Delete arrow"
              title="Delete arrow"
              onClick={onDelete}
            >
              <BoardIcon name="delete" />
            </button>
          </div>
        </foreignObject>
      </g>
    )
  }
  return (
    <foreignObject
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className={`${styles.object} ${item.kind === "sticky" ? styles.sticky : ""}`}
      >
        {header}
        {item.kind === "kanban" ? (
          <div className={styles.miniBoard}>
            {columns.map((column) => (
              <section key={column}>
                <h3>{column}</h3>
                {tasks
                  .filter((t) => t.column === column)
                  .map((t) => (
                    <div className={styles.miniTask} key={t.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={t.done}
                          onChange={(e) =>
                            onTaskChange(t.id, { done: e.target.checked })
                          }
                        />
                        {t.title}
                      </label>
                      <select
                        aria-label={`Move ${t.title}`}
                        value={t.column}
                        onChange={(e) =>
                          onTaskChange(t.id, { column: e.target.value })
                        }
                      >
                        {columns.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const title = String(
                      new FormData(e.currentTarget).get("title") ?? ""
                    ).trim()
                    if (title) {
                      onTask(title, column)
                      e.currentTarget.reset()
                    }
                  }}
                >
                  <input
                    aria-label={`New task in ${column}`}
                    name="title"
                    required
                    placeholder="New task…"
                  />
                  <button>Add</button>
                </form>
              </section>
            ))}
          </div>
        ) : item.kind === "document" ? (
          <DocumentEditor html={item.html} text={item.text} onChange={(html, text) => onChange({ html, text })} />
        ) : (
          <textarea
            aria-label={
              item.kind === "sticky" ? "Sticky note" : "Document text"
            }
            placeholder={
              item.kind === "sticky"
                ? "Write an idea…"
                : "Start writing your document…"
            }
            value={item.text}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        )}
        <button
          className={styles.resizeObject}
          disabled={!!item.locked}
          aria-label={`Resize ${item.kind}`}
          title="Drag to resize; arrow keys adjust size"
          onPointerDown={(e) => start(e, "resize")}
          {...events}
          onKeyDown={(e) => {
            if (item.locked) return
            const dx =
                e.key === "ArrowRight" ? 10 : e.key === "ArrowLeft" ? -10 : 0,
              dy = e.key === "ArrowDown" ? 10 : e.key === "ArrowUp" ? -10 : 0
            if (dx || dy) {
              e.preventDefault()
              onChange({
                width: Math.max(220, item.width + dx),
                height: Math.max(170, item.height + dy),
              })
            }
          }}
        >
          ↘
        </button>
      </div>
    </foreignObject>
  )
}
