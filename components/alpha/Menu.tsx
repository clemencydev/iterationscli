"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import styles from "./workspace.module.css"

export type MenuItem = {
  label: ReactNode
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
}

/**
 * A small dropdown: a trigger button and a list of actions. The list is
 * positioned against the viewport so scrolling containers never clip it.
 * Closes on outside press, Escape, or after choosing.
 */
export default function Menu({
  label,
  children,
  items,
  className,
  align = "end",
}: {
  /** Accessible name of the trigger. */
  label: string
  /** Trigger contents. */
  children: ReactNode
  items: MenuItem[]
  className?: string
  align?: "start" | "end"
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null
  )
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const open = position !== null

  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
    const close = (event: Event) => {
      if (
        event.target instanceof Node &&
        (list.current?.contains(event.target) ||
          trigger.current?.contains(event.target))
      )
        return
      setPosition(null)
    }
    const dismiss = () => setPosition(null)
    document.addEventListener("pointerdown", close, true)
    window.addEventListener("resize", dismiss)
    window.addEventListener("scroll", close, true)
    return () => {
      document.removeEventListener("pointerdown", close, true)
      window.removeEventListener("resize", dismiss)
      window.removeEventListener("scroll", close, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          if (open) return setPosition(null)
          const rect = e.currentTarget.getBoundingClientRect()
          setPosition({
            x: align === "end" ? rect.right : rect.left,
            y: rect.bottom + 4,
          })
        }}
      >
        {children}
      </button>
      {position && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          className={styles.menu}
          style={{
            top: position.y,
            ...(align === "end"
              ? { right: `calc(100vw - ${position.x}px)` }
              : { left: position.x }),
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              e.stopPropagation()
              setPosition(null)
              trigger.current?.focus()
              return
            }
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
            e.preventDefault()
            const buttons = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)"
              )
            )
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement
            )
            buttons[
              (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length
            ]?.focus()
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              className={item.danger ? styles.menuDanger : undefined}
              onClick={() => {
                setPosition(null)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
