"use client"
import { useRef, type CSSProperties, type PointerEvent } from "react"
import {
  nearestSide,
  STICKY_COLORS,
  TEXT_SIZES,
  type WhiteboardObject,
  type Task,
} from "@/lib/alpha"
import styles from "./whiteboard.module.css"
import BoardIcon from "./BoardIcon"
import DocumentEditor from "./DocumentEditor"

type DragKind = "move" | "resize" | "start" | "end"
const MIN_SIZE: Partial<Record<WhiteboardObject["kind"], [number, number]>> = {
  text: [120, 56],
  link: [200, 92],
}
const NAMES: Record<WhiteboardObject["kind"], string> = {
  sticky: "sticky note",
  kanban: "task board",
  arrow: "arrow",
  document: "document",
  text: "text",
  link: "ticket link",
}

export default function BoardObject({
  item,
  zoom,
  columns,
  tasks,
  onChange,
  onDelete,
  onTask,
  onTaskChange,
  findTarget,
  onConnectHover,
  onLinkTicket,
  onOpenTask,
}: {
  item: WhiteboardObject
  zoom: number
  columns: string[]
  tasks: Task[]
  onChange: (patch: Partial<WhiteboardObject>) => void
  onDelete: () => void
  onTask: (title: string, column: string) => void
  onTaskChange: (id: string, patch: Partial<Task>) => void
  /** Item an arrow end would attach to at a canvas point. */
  findTarget: (
    point: { x: number; y: number },
    exclude?: string
  ) => WhiteboardObject | undefined
  /** Highlights the item an arrow end is being dragged over. */
  onConnectHover: (id: string | null) => void
  /** Adds a ticket link node connected to this item. */
  onLinkTicket: () => void
  onOpenTask: (id: string) => void
}) {
  const drag = useRef<{
    x: number
    y: number
    original: WhiteboardObject
    kind: DragKind
    point?: { x: number; y: number }
  } | null>(null)
  const [minWidth, minHeight] = MIN_SIZE[item.kind] ?? [220, 170]
  function start(e: PointerEvent<Element>, kind: DragKind) {
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
    if (kind === "move")
      onChange({
        x: o.x + dx,
        y: o.y + dy,
        ...(o.kind === "arrow" ? { from: undefined, to: undefined } : {}),
      })
    if (kind === "resize")
      onChange({
        width: Math.max(minWidth, o.width + dx),
        height: Math.max(minHeight, o.height + dy),
      })
    if (kind === "end") {
      const point = { x: o.x + o.width + dx, y: o.y + o.height + dy }
      drag.current.point = point
      onConnectHover(findTarget(point, o.from?.objectId)?.id ?? null)
      onChange({
        x: o.x,
        y: o.y,
        width: o.width + dx,
        height: o.height + dy,
        to: undefined,
      })
    }
    if (kind === "start") {
      const point = { x: o.x + dx, y: o.y + dy }
      drag.current.point = point
      onConnectHover(findTarget(point, o.to?.objectId)?.id ?? null)
      onChange({
        x: point.x,
        y: point.y,
        width: o.width - dx,
        height: o.height - dy,
        from: undefined,
      })
    }
  }
  function finish() {
    const d = drag.current
    drag.current = null
    if (!d || (d.kind !== "start" && d.kind !== "end")) return
    onConnectHover(null)
    if (!d.point) return
    // Dropping an arrow end on an item attaches it to that item's nearest side.
    const other = d.kind === "end" ? d.original.from : d.original.to
    const target = findTarget(d.point, other?.objectId)
    if (!target) return
    const connection = {
      objectId: target.id,
      side: nearestSide(target, d.point),
    }
    onChange(d.kind === "end" ? { to: connection } : { from: connection })
  }
  const events = {
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: () => {
      drag.current = null
      onConnectHover(null)
    },
  }
  const nudge = (key: string) => ({
    dx: key === "ArrowRight" ? 10 : key === "ArrowLeft" ? -10 : 0,
    dy: key === "ArrowDown" ? 10 : key === "ArrowUp" ? -10 : 0,
  })

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
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ pointerEvents: "none" }}
        />
        <polyline
          points={`${head[0]} ${x2},${y2} ${head[1]}`}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
        {(["start", "end"] as const).map((end, i) => (
          <circle
            key={end}
            className={styles.arrowHandle}
            cx={i ? x2 : item.x}
            cy={i ? y2 : item.y}
            r={7 / Math.max(zoom, 0.5)}
            fill="var(--background)"
            stroke="var(--alpha-accent)"
            strokeWidth={2 / Math.max(zoom, 0.5)}
            tabIndex={0}
            role="button"
            aria-label={`Move arrow ${end}. Drop it on an item to connect.`}
            style={{ cursor: "crosshair", touchAction: "none" }}
            onPointerDown={(e) => start(e, end)}
            {...events}
            onKeyDown={(e) => {
              const { dx, dy } = nudge(e.key)
              if (!dx && !dy) return
              e.preventDefault()
              onChange(
                end === "end"
                  ? {
                      x: item.x,
                      y: item.y,
                      width: item.width + dx,
                      height: item.height + dy,
                      to: undefined,
                    }
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
              <BoardIcon name="delete" size={15} />
            </button>
          </div>
        </foreignObject>
      </g>
    )
  }

  const bare = item.kind === "sticky" || item.kind === "text"
  const linked =
    item.kind === "link" ? tasks.find((t) => t.id === item.taskId) : undefined
  const header = (
    <div className={styles.objectHeader}>
      <button
        className={styles.moveObject}
        disabled={!!item.locked}
        aria-label={`Move ${NAMES[item.kind]}`}
        title="Drag to move; arrow keys nudge"
        onPointerDown={(e) => start(e, "move")}
        {...events}
        onKeyDown={(e) => {
          if (item.locked) return
          const { dx, dy } = nudge(e.key)
          if (dx || dy) {
            e.preventDefault()
            onChange({ x: item.x + dx, y: item.y + dy })
          }
        }}
      >
        <BoardIcon name={bare ? "grip" : item.kind} size={16} />
        {!bare && (
          <span>
            {item.kind === "kanban"
              ? "Task board"
              : item.kind === "link"
                ? "Ticket"
                : "Document"}
          </span>
        )}
      </button>
      {item.kind === "sticky" && (
        <div className={styles.swatches} role="group" aria-label="Note color">
          {STICKY_COLORS.map((color) => (
            <button
              key={color}
              title={`Note color ${color}`}
              aria-label={`Note color ${color}`}
              aria-pressed={(item.color ?? STICKY_COLORS[0]) === color}
              style={{ "--swatch": color } as CSSProperties}
              onClick={() => onChange({ color })}
            />
          ))}
          <input
            type="color"
            title="Custom note color"
            aria-label="Custom note color"
            value={item.color ?? STICKY_COLORS[0]}
            onChange={(e) => onChange({ color: e.target.value })}
          />
        </div>
      )}
      {item.kind === "text" && (
        <div className={styles.swatches} role="group" aria-label="Text style">
          <select
            aria-label="Text size"
            title="Text size"
            value={item.fontSize ?? 18}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
          >
            {TEXT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <input
            type="color"
            title="Text color"
            aria-label="Text color"
            value={item.color ?? "#e5e5e5"}
            onChange={(e) => onChange({ color: e.target.value })}
          />
          {item.color && (
            <button
              title="Use the theme's text color"
              aria-label="Reset text color"
              onClick={() => onChange({ color: undefined })}
            >
              <BoardIcon name="undo" size={14} />
            </button>
          )}
        </div>
      )}
      {item.kind === "link" && (
        <select
          className={styles.linkPicker}
          aria-label="Linked ticket"
          title="Choose the ticket this node opens"
          value={linked?.id ?? ""}
          onChange={(e) => onChange({ taskId: e.target.value || undefined })}
        >
          <option value="">Choose ticket…</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      )}
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
          <BoardIcon name={item.locked ? "lock" : "unlock"} size={16} />
        </button>
      )}
      {item.kind !== "link" && (
        <button
          onClick={onLinkTicket}
          aria-label={`Link this ${NAMES[item.kind]} to a ticket`}
          title="Link to a ticket"
        >
          <BoardIcon name="link" size={16} />
        </button>
      )}
      <button
        onClick={onDelete}
        aria-label={`Delete ${NAMES[item.kind]}`}
        title="Delete"
      >
        <BoardIcon name="delete" size={16} />
      </button>
    </div>
  )
  return (
    <foreignObject
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className={`${styles.object} ${styles[item.kind] ?? ""}`}
        style={
          item.kind === "sticky"
            ? ({ "--sticky": item.color ?? STICKY_COLORS[0] } as CSSProperties)
            : undefined
        }
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
                        <span className={t.done ? styles.struck : ""}>
                          {t.title}
                        </span>
                      </label>
                      <div>
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
                        <button
                          aria-label={`Open ${t.title}`}
                          title="Open ticket beside the canvas"
                          onClick={() => onOpenTask(t.id)}
                        >
                          <BoardIcon name="open" size={13} />
                        </button>
                      </div>
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
          <DocumentEditor
            html={item.html}
            text={item.text}
            onChange={(html, text) => onChange({ html, text })}
          />
        ) : item.kind === "link" ? (
          linked ? (
            <button
              className={styles.linkOpen}
              onClick={() => onOpenTask(linked.id)}
              title="Open this ticket beside the canvas"
            >
              <span
                className={`${styles.linkState} ${linked.done ? styles.linkDone : ""}`}
                aria-hidden="true"
              >
                {linked.done ? "✓" : ""}
              </span>
              <span className={styles.linkText}>
                <strong className={linked.done ? styles.struck : ""}>
                  {linked.title}
                </strong>
                <small>
                  {linked.column} · {linked.id.slice(0, 8)}
                </small>
              </span>
              <BoardIcon name="open" size={15} />
            </button>
          ) : (
            <p className={styles.linkEmpty}>
              {item.taskId
                ? "This ticket no longer exists. Choose another above."
                : tasks.length
                  ? "Choose a ticket above. Clicking this node then opens it beside the canvas."
                  : "No tickets yet. Create one on the task board first."}
            </p>
          )
        ) : (
          <textarea
            aria-label={item.kind === "sticky" ? "Sticky note" : "Text"}
            placeholder={item.kind === "sticky" ? "Write an idea…" : "Type…"}
            value={item.text}
            style={
              item.kind === "text"
                ? { fontSize: item.fontSize ?? 18, color: item.color }
                : undefined
            }
            onChange={(e) => onChange({ text: e.target.value })}
          />
        )}
        <button
          className={styles.resizeObject}
          disabled={!!item.locked}
          aria-label={`Resize ${NAMES[item.kind]}`}
          title="Drag to resize; arrow keys adjust size"
          onPointerDown={(e) => start(e, "resize")}
          {...events}
          onKeyDown={(e) => {
            if (item.locked) return
            const { dx, dy } = nudge(e.key)
            if (dx || dy) {
              e.preventDefault()
              onChange({
                width: Math.max(minWidth, item.width + dx),
                height: Math.max(minHeight, item.height + dy),
              })
            }
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M9 3 3 9M9 7 7 9"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </div>
    </foreignObject>
  )
}
