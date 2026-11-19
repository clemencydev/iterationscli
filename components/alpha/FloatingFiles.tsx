"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import styles from "./workspace.module.css"

export default function FloatingFiles({ children, onClose }: {
  children: ReactNode
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [position, setPosition] = useState({ x: 24, y: 64 })
  useEffect(() => {
    panel.current?.focus()
    const clamp = () => {
      const rect = panel.current?.getBoundingClientRect()
      if (rect) setPosition((p) => ({
        x: Math.max(0, Math.min(p.x, window.innerWidth - rect.width)),
        y: Math.max(0, Math.min(p.y, window.innerHeight - rect.height)),
      }))
    }
    clamp()
    window.addEventListener("resize", clamp)
    return () => window.removeEventListener("resize", clamp)
  }, [])
  return (
    <div ref={panel} role="dialog" aria-label="File explorer" tabIndex={-1}
      className={`${styles.floatingTerminal} ${styles.floatingFiles}`}
      style={{ left: position.x, top: position.y }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault()
          onClose()
        }
      }}>
      <header className={`${styles.popupTitlebar} ${styles.dragTitlebar}`}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX - position.x, y: e.clientY - position.y }
        }}
        onPointerMove={(e) => {
          if (!drag.current || !panel.current) return
          setPosition({
            x: Math.max(0, Math.min(window.innerWidth - panel.current.offsetWidth, e.clientX - drag.current.x)),
            y: Math.max(0, Math.min(window.innerHeight - panel.current.offsetHeight, e.clientY - drag.current.y)),
          })
        }}
        onLostPointerCapture={() => { drag.current = null }}>
        <h2>File explorer</h2>
        <button aria-label="Close file explorer" onClick={onClose}>×</button>
      </header>
      <div className={styles.popupBody}>{children}</div>
    </div>
  )
}
