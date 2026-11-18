"use client"

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react"
import {
  MAX_RATIO,
  MIN_RATIO,
  zoneAt,
  type Leaf,
  type Pane,
  type Zone,
} from "@/lib/panes"
import styles from "./panes.module.css"

/** What a dragged view carries, so panes can tell it from any other drag. */
export const VIEW_DRAG = "application/x-iterations-view"

/**
 * A divider between two panes. Drag it, or focus it and use the arrow keys;
 * double-click evens the two sides out. It measures its parent, so it works
 * for any two flex children around it.
 */
export function Divider({
  direction,
  ratio,
  onChange,
  label = "Resize panes",
}: {
  /** "row": the divider is a vertical bar between left and right. */
  direction: "row" | "column"
  ratio: number
  onChange: (ratio: number) => void
  label?: string
}) {
  const dragging = useRef(false)
  const row = direction === "row"
  return (
    <div
      className={styles.divider}
      data-direction={direction}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(MIN_RATIO * 100)}
      aria-valuemax={Math.round(MAX_RATIO * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      title="Drag to resize · double-click to even out"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const box = e.currentTarget.parentElement?.getBoundingClientRect()
        if (!dragging.current || !box) return
        onChange(
          row
            ? (e.clientX - box.left) / Math.max(1, box.width)
            : (e.clientY - box.top) / Math.max(1, box.height)
        )
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onDoubleClick={() => onChange(0.5)}
      onKeyDown={(e) => {
        const back = row ? "ArrowLeft" : "ArrowUp"
        const forward = row ? "ArrowRight" : "ArrowDown"
        if (e.key !== back && e.key !== forward) return
        e.preventDefault()
        e.stopPropagation()
        onChange(ratio + (e.key === forward ? 0.03 : -0.03))
      }}
    />
  )
}

type Hover = { id: string; zone: Zone }

/** The tree of panes: splits with dividers, and a frame around each leaf. */
export function PaneTree<V extends string>({
  layout,
  focus,
  multi,
  dragging,
  title,
  renderLeaf,
  onFocus,
  onResize,
  onDropView,
  onSplit,
  onClose,
  onDragView,
}: {
  layout: Pane<V>
  /** Id of the pane the keyboard belongs to. */
  focus: string
  /** More than one pane is open: show each pane's bar. */
  multi: boolean
  /** A view is being dragged somewhere in the workspace. */
  dragging: boolean
  title: (leaf: Leaf<V>) => ReactNode
  renderLeaf: (leaf: Leaf<V>) => ReactNode
  onFocus: (id: string) => void
  onResize: (splitId: string, ratio: number) => void
  onDropView: (target: string, zone: Zone) => void
  onSplit: (id: string, direction: "row" | "column") => void
  onClose: (id: string) => void
  /** A pane's bar started (view) or stopped (null) being dragged. */
  onDragView: (view: V | null) => void
}) {
  const [hovered, setHover] = useState<Hover | null>(null)
  // A drag can end anywhere, including outside the window, so the preview
  // only counts while one is still going on.
  const hover = dragging ? hovered : null

  const over = (e: DragEvent<HTMLDivElement>, id: string) => {
    if (!dragging) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    const box = e.currentTarget.getBoundingClientRect()
    const zone = zoneAt(
      e.clientX - box.left,
      e.clientY - box.top,
      box.width,
      box.height
    )
    setHover((current) =>
      current?.id === id && current.zone === zone ? current : { id, zone }
    )
  }

  const node = (pane: Pane<V>): ReactNode => {
    if (pane.type === "split")
      return (
        <div className={styles.split} data-direction={pane.direction}>
          <div className={styles.side} style={{ flexGrow: pane.ratio }}>
            {node(pane.a)}
          </div>
          <Divider
            direction={pane.direction}
            ratio={pane.ratio}
            onChange={(ratio) => onResize(pane.id, ratio)}
          />
          <div className={styles.side} style={{ flexGrow: 1 - pane.ratio }}>
            {node(pane.b)}
          </div>
        </div>
      )
    const focused = pane.id === focus
    return (
      <div
        key={pane.id}
        className={styles.frame}
        data-pane={pane.id}
        data-focused={multi && focused ? "" : undefined}
        tabIndex={-1}
        onPointerDownCapture={() => onFocus(pane.id)}
        onFocusCapture={() => onFocus(pane.id)}
        onDragOver={(e) => over(e, pane.id)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setHover((current) => (current?.id === pane.id ? null : current))
        }}
        onDrop={(e) => {
          if (!dragging || !hover) return
          e.preventDefault()
          onDropView(pane.id, hover.zone)
          setHover(null)
        }}
      >
        {multi && (
          <div
            className={styles.bar}
            draggable={pane.view !== null}
            onDragStart={(e) => {
              if (pane.view === null) return
              e.dataTransfer.setData(VIEW_DRAG, pane.view)
              e.dataTransfer.effectAllowed = "move"
              onDragView(pane.view)
            }}
            onDragEnd={() => onDragView(null)}
            title="Drag onto another pane to move this one"
          >
            <span className={styles.name}>{title(pane)}</span>
            <button
              type="button"
              aria-label="Split side by side"
              title="Split side by side (Ctrl+\)"
              onClick={() => onSplit(pane.id, "row")}
            >
              ◫
            </button>
            <button
              type="button"
              aria-label="Split top and bottom"
              title="Split top and bottom (Ctrl+Shift+\)"
              onClick={() => onSplit(pane.id, "column")}
            >
              ⬓
            </button>
            <button
              type="button"
              aria-label="Close pane"
              title="Close pane"
              onClick={() => onClose(pane.id)}
            >
              ×
            </button>
          </div>
        )}
        <div className={styles.body}>{renderLeaf(pane)}</div>
        {hover?.id === pane.id && (
          <div
            className={styles.drop}
            data-zone={hover.zone}
            aria-hidden="true"
          />
        )}
      </div>
    )
  }
  return <div className={styles.root}>{node(layout)}</div>
}

/**
 * An empty pane: "What would you like to open?" ↑/↓ or the number keys pick,
 * Enter opens, Esc closes the pane again.
 */
export function PaneChooser<V extends string>({
  options,
  onPick,
  onClose,
  autoFocus,
}: {
  options: { view: V; label: ReactNode; hint?: string }[]
  onPick: (view: V) => void
  onClose: () => void
  autoFocus: boolean
}) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoFocus)
      list.current?.querySelector("button")?.focus({ preventScroll: true })
  }, [autoFocus])
  return (
    <div
      className={styles.chooser}
      ref={list}
      onKeyDown={(e) => {
        const buttons = [
          ...(list.current?.querySelectorAll<HTMLButtonElement>(
            "button[data-option]"
          ) ?? []),
        ]
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          e.stopPropagation()
          const next =
            (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
          buttons[at < 0 ? 0 : next]?.focus()
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        } else if (/^[1-9]$/.test(e.key) && options[Number(e.key) - 1]) {
          e.preventDefault()
          e.stopPropagation()
          onPick(options[Number(e.key) - 1].view)
        }
      }}
    >
      <h2>What would you like to open?</h2>
      {options.length === 0 && <p>Every view is already open.</p>}
      {options.map((option, i) => (
        <button
          type="button"
          key={option.view}
          data-option
          onClick={() => onPick(option.view)}
        >
          <kbd>{i + 1}</kbd>
          <span>{option.label}</span>
          {option.hint && <small>{option.hint}</small>}
        </button>
      ))}
      <p>
        ↑ ↓ and Enter, or a number · Esc closes this pane · or drag a view
        here
      </p>
    </div>
  )
}
