"use client"

import { useEffect } from "react"
import { applyFont, readSavedFont } from "@/lib/font-client"
import { restoreScheme } from "@/lib/theme-client"

/**
 * Applies the font and the site theme chosen in Customize on every page.
 * Renders nothing.
 */
export default function FontLoader() {
  useEffect(() => {
    restoreScheme()
    const font = readSavedFont()
    if (font) applyFont(font).catch(() => {})
  }, [])
  return null
}
