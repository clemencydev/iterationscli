"use client"

import { useEffect } from "react"
import { applyFont, readSavedFont } from "@/lib/font-client"

/** Applies the font chosen in Customize on every page. Renders nothing. */
export default function FontLoader() {
  useEffect(() => {
    const font = readSavedFont()
    if (font) applyFont(font).catch(() => {})
  }, [])
  return null
}
