"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type Dispatch,
  type SetStateAction,
} from "react"
import type {
  DrawingGroup,
  LineEnd,
  Stroke,
  WhiteboardObject,
  Task,
} from "@/lib/alpha"
import {
  LINE_ENDS,
  LINK_STYLES,
  lineEnds,
  resolveArrow,
  objectAt,
  PEN_WIDTHS,
} from "@/lib/alpha"
import BoardObject from "./BoardObject"
import BoardIcon, { type BoardIconName } from "./BoardIcon"
import styles from "./whiteboard.module.css"
import {
  emptySelection,
  boxBetween,
  selectInBox,
  selectionBox,
  strokeHit,
  moveItems,
  neighbour,
  objectBox,
  withGroups,
  type Box,
  type CanvasSelection,
  type Direction,
  type SelectionAction,
} from "@/lib/canvas-selection"

const ARROW_KEYS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
}

const CREATE: [WhiteboardObject["kind"], string, string][] = [
  ["sticky", "Sticky", "Add a sticky note"],
  ["text", "Text", "Add free text"],
  ["document", "Document", "Add a document"],
  ["kanban", "Kanban", "Add the task board"],
  ["arrow", "Arrow", "Add an arrow. Drop its ends on items to connect them"],
  [
    "link",
    "Ticket",
    "Add a ticket link. Clicking it opens the ticket beside the canvas",
  ],
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
  onSelectionAction,
  focusItem,
  groups,
  onConnect,
}: {
  /** Named drawings: pen strokes that are selected and referred to as one. */
  groups: DrawingGroup[]
  /** Draw an arrow from one item to another. */
  onConnect: (from: string, to: string) => void
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
  focusItem?: { id: string; request: number } | null
  onSelectionAction: (
    selected: CanvasSelection,
    action: SelectionAction
  ) => void
}) {
  const [tool, setTool] = useState<"select" | "pen" | "hand" | "eraser">(
    "select"
  )
  const [picked, setChosen] = useState<CanvasSelection>(emptySelection)
  // Picking one stroke of a drawing picks the whole drawing.
  const chosen = useMemo(() => withGroups(strokes, picked), [strokes, picked])
  /** Item a connection is being drawn from, while its other end is chosen. */
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [groupName, setGroupName] = useState("")
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [offset, setOffset] = useState({ dx: 0, dy: 0 })
  const [erased, setErased] = useState<string[]>([])
  const erasedRef = useRef(new Set<string>())
  const [comment, setComment] = useState("")
  const preview = moveItems(objects, strokes, chosen, offset.dx, offset.dy)
  const selectedBounds = selectionBox(preview.objects, preview.strokes, chosen)
  const selectedItems = [
    ...objects.filter((o) => chosen.objects.includes(o.id)),
    ...strokes.filter((s) => chosen.strokes.includes(s.id)),
  ]
  const [connectTarget, setConnectTarget] = useState<string | null>(null)
  const [draft, setDraft] = useState<[number, number][]>([])
  const [notesOpen, setNotesOpen] = useState(false)
  const [selection, setSelection] = useState("")
  const svg = useRef<SVGSVGElement>(null)
  const focusedRequest = useRef<number | null>(null)
  useEffect(() => {
    if (!focusItem || focusedRequest.current === focusItem.request) return
    const frame = requestAnimationFrame(() => {
      const selected = {
        objects: objects.some((o) => o.id === focusItem.id)
          ? [focusItem.id]
          : [],
        // A drawing's id stands for all of its strokes.
        strokes: strokes
          .filter((s) => s.id === focusItem.id || s.group === focusItem.id)
          .map((s) => s.id),
      }
      const box = selectionBox(objects, strokes, selected),
        rect = svg.current?.getBoundingClientRect()
      if (!box || !rect) return
      focusedRequest.current = focusItem.request
      const zoom = Math.max(
        0.1,
        Math.min(
          1,
          (rect.width - 180) / Math.max(1, box.width),
          (rect.height - 120) / Math.max(1, box.height)
        )
      )
      setCamera({
        zoom,
        x: rect.width / 2 - (box.x + box.width / 2) * zoom,
        y: rect.height / 2 - (box.y + box.height / 2) * zoom,
      })
      setChosen(selected)
      setTool("select")
    })
    return () => cancelAnimationFrame(frame)
  }, [focusItem, objects, strokes, setCamera])
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
    kind: "pen" | "hand" | "select" | "eraser" | "move"
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

  /** The one object selected, when the selection is exactly that. */
  const single =
    chosen.objects.length === 1 && !chosen.strokes.length
      ? objects.find((o) => o.id === chosen.objects[0])
      : undefined
  const linkSource = objects.find((o) => o.id === linkFrom)
  /** The item a connection being drawn would end on. */
  const linkTarget =
    linkSource && single && single.kind !== "arrow" && single.id !== linkFrom
      ? single
      : undefined
  /** The two items a selection of exactly two would connect. */
  const pair =
    chosen.objects.length === 2 && !chosen.strokes.length
      ? objects.filter(
          (o) => chosen.objects.includes(o.id) && o.kind !== "arrow"
        )
      : []
  /** The drawing the selected strokes are, when they are exactly one. */
  const drawing = groups.find((g) => {
    const members = strokes.filter((s) => s.group === g.id)
    return (
      members.length > 0 &&
      members.length === chosen.strokes.length &&
      members.every((s) => chosen.strokes.includes(s.id))
    )
  })
  /** Selects one item and brings it into view if it is off screen. */
  function select(id: string) {
    setChosen({ objects: [id], strokes: [] })
    setTool("select")
    const item = objects.find((o) => o.id === id)
    const rect = svg.current?.getBoundingClientRect()
    if (!item || !rect) return
    const box = objectBox(item, objects)
    const x = (box.x + box.width / 2) * camera.zoom + camera.x
    const y = (box.y + box.height / 2) * camera.zoom + camera.y
    if (x < 60 || y < 60 || x > rect.width - 60 || y > rect.height - 60)
      setCamera((c) => ({
        ...c,
        x: rect.width / 2 - (box.x + box.width / 2) * c.zoom,
        y: rect.height / 2 - (box.y + box.height / 2) * c.zoom,
      }))
  }
  function connect(from: string, to: string) {
    onConnect(from, to)
    setLinkFrom(null)
  }
  const saved = palette.includes(color.toLowerCase())
  const target = objects.find((o) => o.id === connectTarget)
  const toolButton = (
    name: "select" | "pen" | "hand" | "eraser",
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
    <section
      className={styles.whiteboard}
      aria-label="Whiteboard"
      onKeyDown={(e) => {
        if (
          (e.target as HTMLElement).closest(
            "input,textarea,select,[contenteditable=true]"
          )
        )
          return
        // A focused handle that used the key (to nudge an item) keeps it.
        if (e.isDefaultPrevented() || e.ctrlKey || e.metaKey || e.altKey)
          return
        if (e.key === "Escape") {
          // Esc backs out one step: a connection being drawn, then the selection.
          if (linkFrom) setLinkFrom(null)
          else setChosen(emptySelection())
          setMarquee(null)
        }
        if (
          (e.key === "Delete" || e.key === "Backspace") &&
          selectedItems.length
        ) {
          e.preventDefault()
          onSelectionAction(chosen, { type: "delete" })
          setChosen(emptySelection())
        }
        // The arrow keys walk the selection from item to item (they do not
        // scroll): each press goes to the nearest item in that direction.
        const direction = ARROW_KEYS[e.key]
        if (direction) {
          e.preventDefault()
          const rect = svg.current?.getBoundingClientRect()
          const next = neighbour(objects, single?.id, direction, {
            x: ((rect?.width ?? 0) / 2 - camera.x) / camera.zoom,
            y: ((rect?.height ?? 0) / 2 - camera.y) / camera.zoom,
          })
          if (next) select(next)
        }
        if (e.key.toLowerCase() === "l" && single && single.kind !== "arrow") {
          e.preventDefault()
          setLinkFrom(single.id)
        }
        if (e.key === "Enter" && linkTarget) {
          e.preventDefault()
          connect(linkFrom!, linkTarget.id)
        }
      }}
    >
      <svg
        ref={svg}
        tabIndex={0}
        data-keys
        className={styles.surface}
        style={{
          cursor:
            tool === "hand"
              ? "grab"
              : tool === "select"
                ? "default"
                : "crosshair",
          backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
        aria-label="Drawing surface. Use the pen to draw or the hand to pan."
        onContextMenu={(e) => e.preventDefault()}
        onPointerDownCapture={(e) => {
          if (gesture.current || (e.button !== 0 && e.button !== 1)) return
          const target = e.target as Element
          const moving = !!target.closest("[data-selection-move]")
          if (e.button !== 1 && !moving && target.closest("foreignObject"))
            return
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.focus()
          e.currentTarget.setPointerCapture(e.pointerId)
          const kind = e.button === 1 ? "hand" : moving ? "move" : tool
          const p = point(e)
          gesture.current = {
            pointer: e.pointerId,
            kind,
            x: e.clientX,
            y: e.clientY,
            camera,
            points: [p],
          }
          if (kind === "select") {
            setChosen(emptySelection())
            setMarquee(boxBetween(p, p))
          }
          if (kind === "pen") setDraft([p])
          if (kind === "eraser") {
            erasedRef.current = new Set(
              strokes
                .filter((s) => strokeHit(s, p, 10 / camera.zoom))
                .map((s) => s.id)
            )
            setErased([...erasedRef.current])
          }
        }}
        onPointerMoveCapture={(e) => {
          const g = gesture.current
          if (!g || g.pointer !== e.pointerId) return
          e.stopPropagation()
          const p = point(e)
          if (g.kind === "hand")
            setCamera({
              ...g.camera,
              x: g.camera.x + e.clientX - g.x,
              y: g.camera.y + e.clientY - g.y,
            })
          else if (g.kind === "select") {
            const box = boxBetween(g.points[0], p)
            setMarquee(box)
            setChosen(selectInBox(objects, strokes, box))
          } else if (g.kind === "move")
            setOffset({
              dx: (e.clientX - g.x) / camera.zoom,
              dy: (e.clientY - g.y) / camera.zoom,
            })
          else if (g.kind === "eraser") {
            const previous = g.points.at(-1)!
            const steps = Math.max(
              1,
              Math.ceil(
                Math.hypot(p[0] - previous[0], p[1] - previous[1]) /
                  (5 / camera.zoom)
              )
            )
            for (let i = 1; i <= steps; i++) {
              const at: [number, number] = [
                previous[0] + ((p[0] - previous[0]) * i) / steps,
                previous[1] + ((p[1] - previous[1]) * i) / steps,
              ]
              for (const s of strokes)
                if (
                  !erasedRef.current.has(s.id) &&
                  strokeHit(s, at, 10 / camera.zoom)
                )
                  erasedRef.current.add(s.id)
            }
            g.points.push(p)
            setErased([...erasedRef.current])
          } else {
            g.points.push(p)
            setDraft([...g.points])
          }
        }}
        onPointerUpCapture={(e) => {
          const g = gesture.current
          if (!g || g.pointer !== e.pointerId) return
          e.stopPropagation()
          if (g.kind === "pen")
            onStroke({
              id: crypto.randomUUID(),
              color,
              width: penWidth,
              points: [...g.points, point(e)],
            })
          if (g.kind === "move") {
            const dx = (e.clientX - g.x) / camera.zoom,
              dy = (e.clientY - g.y) / camera.zoom
            if (dx || dy) onSelectionAction(chosen, { type: "move", dx, dy })
          }
          if (g.kind === "select")
            setChosen(
              selectInBox(objects, strokes, boxBetween(g.points[0], point(e)))
            )
          if (g.kind === "eraser" && erasedRef.current.size)
            onSelectionAction(
              { objects: [], strokes: [...erasedRef.current] },
              { type: "delete" }
            )
          gesture.current = null
          setDraft([])
          setMarquee(null)
          setOffset({ dx: 0, dy: 0 })
          setErased([])
        }}
        onPointerCancelCapture={() => {
          gesture.current = null
          setDraft([])
          setMarquee(null)
          setOffset({ dx: 0, dy: 0 })
          setErased([])
        }}
      >
        <g
          transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}
        >
          {preview.strokes
            .filter((s) => !erased.includes(s.id))
            .map((s) => (
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
          {preview.objects.map((item) => (
            <BoardObject
              key={item.id}
              item={resolveArrow(item, preview.objects)}
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
          {selectedBounds && !marquee && tool === "select" && (
            <rect
              data-selection-move="true"
              x={selectedBounds.x - 6 / camera.zoom}
              y={selectedBounds.y - 6 / camera.zoom}
              width={selectedBounds.width + 12 / camera.zoom}
              height={selectedBounds.height + 12 / camera.zoom}
              fill="transparent"
              stroke="var(--primary)"
              strokeWidth={1.5 / camera.zoom}
              strokeDasharray={`${6 / camera.zoom} ${4 / camera.zoom}`}
              // One item keeps its own handles and text usable while selected.
              style={{
                cursor: "move",
                touchAction: "none",
                pointerEvents: single ? "none" : undefined,
              }}
            />
          )}
          {selectedBounds && !marquee && tool === "select" && (
            // The ID to use in the terminal, e.g. `link a1b2c3d4 …`.
            <text
              className={styles.idBadge}
              x={selectedBounds.x - 6 / camera.zoom}
              y={selectedBounds.y - 12 / camera.zoom}
              fontSize={11 / camera.zoom}
            >
              {single
                ? `${single.kind} · ${single.id.slice(0, 8)}`
                : drawing
                  ? `${drawing.name} · ${drawing.id.slice(0, 8)}`
                  : `${selectedItems.length} items`}
            </text>
          )}
          {linkSource && (
            <rect
              className={styles.connectTarget}
              x={objectBox(linkSource, objects).x - 6 / camera.zoom}
              y={objectBox(linkSource, objects).y - 6 / camera.zoom}
              width={objectBox(linkSource, objects).width + 12 / camera.zoom}
              height={objectBox(linkSource, objects).height + 12 / camera.zoom}
              strokeWidth={2 / camera.zoom}
            />
          )}
          {marquee && (
            <rect
              {...marquee}
              fill="var(--primary)"
              fillOpacity="0.08"
              stroke="var(--primary)"
              strokeWidth={1 / camera.zoom}
              style={{ pointerEvents: "none" }}
            />
          )}
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
        {toolButton(
          "select",
          "select",
          "Select",
          "Drag to select items; drag the selection to move"
        )}
        {toolButton("pen", "pen", "Pen", "Draw with the pen")}
        {toolButton(
          "eraser",
          "eraser",
          "Eraser",
          "Erase entire pen strokes; restore from History"
        )}
        {toolButton(
          "hand",
          "hand",
          "Pan",
          "Drag to move around the whiteboard"
        )}
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
      {selectedItems.length > 0 && tool === "select" && (
        <aside
          className={`${styles.hud} ${styles.selectionPanel}`}
          aria-label="Selected items"
        >
          <div>
            <strong>{selectedItems.length} selected</strong>
            <button
              onClick={() => setChosen(emptySelection())}
              aria-label="Clear selection"
            >
              ×
            </button>
          </div>
          <p>
            ← ↑ ↓ → move the selection · drag the outline to move the items.
          </p>
          {/* ---- Connecting: from the keyboard (L, arrows, Enter) or here ---- */}
          {linkSource && (
            <div className={styles.linking} role="status">
              Connecting from <code>{linkSource.id.slice(0, 8)}</code>.{" "}
              {linkTarget
                ? "Press Enter to connect to this item."
                : "Select the item to connect to (arrow keys), then Enter."}
              <div>
                {linkTarget && (
                  <button onClick={() => connect(linkSource.id, linkTarget.id)}>
                    Connect ↵
                  </button>
                )}
                <button onClick={() => setLinkFrom(null)}>Cancel (Esc)</button>
              </div>
            </div>
          )}
          {!linkSource && single && single.kind !== "arrow" && (
            <button
              onClick={() => setLinkFrom(single.id)}
              title="Then select another item and press Enter"
            >
              Connect from here (L)
            </button>
          )}
          {!linkSource && pair.length === 2 && (
            <button onClick={() => connect(pair[0].id, pair[1].id)}>
              Connect {pair[0].id.slice(0, 4)} → {pair[1].id.slice(0, 4)}
            </button>
          )}
          {/* ---- An arrow's ends: directed, undirected, both ways, markers ---- */}
          {single?.kind === "arrow" && (
            <div className={styles.endControls}>
              <div>
                {(
                  [
                    ["directed", "A → B"],
                    ["undirected", "A — B"],
                    ["both", "A ↔ B"],
                    ["reverse", "A ← B"],
                  ] as const
                ).map(([style, label]) => (
                  <button
                    key={style}
                    title={style}
                    aria-pressed={
                      lineEnds(single).start === LINK_STYLES[style].start &&
                      lineEnds(single).end === LINK_STYLES[style].end
                    }
                    onClick={() =>
                      onObjectChange(single.id, { ends: LINK_STYLES[style] })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {(["start", "end"] as const).map((side) => (
                <label key={side}>
                  {side === "start" ? "Start" : "End"}
                  <select
                    value={lineEnds(single)[side]}
                    onChange={(e) =>
                      onObjectChange(single.id, {
                        ends: {
                          ...lineEnds(single),
                          [side]: e.target.value as LineEnd,
                        },
                      })
                    }
                  >
                    {LINE_ENDS.map((end) => (
                      <option key={end}>{end}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          {/* ---- Pen strokes as one named drawing ---- */}
          {chosen.strokes.length > 0 && (
            <form
              className={styles.groupForm}
              onSubmit={(e) => {
                e.preventDefault()
                onSelectionAction(chosen, { type: "group", name: groupName })
                setGroupName("")
              }}
            >
              <strong>
                {drawing
                  ? `Drawing · ${drawing.id.slice(0, 8)}`
                  : `${chosen.strokes.length} pen stroke${chosen.strokes.length === 1 ? "" : "s"}`}
              </strong>
              <input
                aria-label="Drawing name"
                placeholder={drawing ? drawing.name : "Name this drawing…"}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
              <div>
                <button>{drawing ? "Rename" : "Group as one drawing"}</button>
                {drawing && (
                  <button
                    type="button"
                    onClick={() => onSelectionAction(chosen, { type: "ungroup" })}
                  >
                    Ungroup
                  </button>
                )}
              </div>
            </form>
          )}
          <button
            onClick={() => {
              onSelectionAction(chosen, { type: "delete" })
              setChosen(emptySelection())
            }}
          >
            Delete selected
          </button>
          <label>
            Task
            <select
              value=""
              onChange={(e) =>
                onSelectionAction(chosen, {
                  type: "assign",
                  taskId:
                    e.target.value === "__clear" ? undefined : e.target.value,
                })
              }
            >
              <option value="" disabled>
                Link to a task…
              </option>
              <option value="__clear">No task</option>
              {tasks.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Column
            <select
              value=""
              onChange={(e) =>
                onSelectionAction(chosen, {
                  type: "assign",
                  column:
                    e.target.value === "__clear" ? undefined : e.target.value,
                })
              }
            >
              <option value="" disabled>
                Categorize under…
              </option>
              <option value="__clear">No column</option>
              {columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (comment.trim()) {
                onSelectionAction(chosen, { type: "comment", text: comment })
                setComment("")
              }
            }}
          >
            <textarea
              aria-label="Comment on selected items"
              placeholder="Comment on these items…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              required
            />
            <button>Add comment to selection</button>
          </form>
          <div className={styles.selectionDetails}>
            {selectedItems
              // A drawing is listed once, not once per stroke.
              .filter(
                (item, i, all) =>
                  "kind" in item ||
                  !item.group ||
                  all.findIndex(
                    (other) => !("kind" in other) && other.group === item.group
                  ) === i
              )
              .map((item) => (
              <div key={item.id}>
                <strong>
                  {"kind" in item
                    ? `${item.kind} · ${item.id.slice(0, 8)}`
                    : item.group
                      ? `${groups.find((g) => g.id === item.group)?.name ?? "Drawing"} · ${item.group.slice(0, 8)}`
                      : `Pen stroke · ${item.id.slice(0, 8)}`}
                </strong>
                {item.taskId && (
                  <p>
                    Task:{" "}
                    <button
                      disabled={!tasks.some((t) => t.id === item.taskId)}
                      onClick={() => onOpenTask(item.taskId!)}
                    >
                      {tasks.find((t) => t.id === item.taskId)?.title ??
                        "Deleted task"}{" "}
                      ↗
                    </button>
                  </p>
                )}
                {item.column && <p>Column: {item.column}</p>}
                {!!item.comments?.length && (
                  <div className={styles.itemComments}>
                    <h4>Comments · {item.comments.length}</h4>
                    {item.comments.map((text, i) => (
                      <blockquote key={i}>
                        <small>◌ Comment {i + 1}</small>
                        <p>{text}</p>
                      </blockquote>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}
      {tool === "pen" && (
        <div
          className={`${styles.hud} ${styles.pen}`}
          role="toolbar"
          aria-label="Pen color and thickness"
        >
          <div
            className={styles.swatches}
            role="group"
            aria-label="Saved colors"
          >
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
            : tool === "select"
              ? "Arrow keys or drag to select · L then Enter connects · Delete removes"
              : tool === "eraser"
                ? "Drag to erase pen strokes"
                : "Drag to pan"}{" "}
        · Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+Y terminal
      </div>
    </section>
  )
}
