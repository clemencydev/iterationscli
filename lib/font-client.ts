"use client"

import {
  FONT_STORAGE,
  fontStack,
  isSavedFont,
  type SavedFont,
} from "./font"

const LINK_ID = "iterationscli-font"
const VARIABLES = ["--font-mono", "--font-sans"]

export function readSavedFont(): SavedFont | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FONT_STORAGE) ?? "null")
    return isSavedFont(value) ? value : null
  } catch {
    return null
  }
}

/** Loads the font and switches the site to it. Rejects if the font cannot be loaded. */
export async function applyFont(font: SavedFont | null) {
  const root = document.documentElement
  document.getElementById(LINK_ID)?.remove()
  if (!font) {
    for (const name of VARIABLES) root.style.removeProperty(name)
    return
  }
  if (font.source === "google" && font.href) {
    await new Promise<void>((resolve, reject) => {
      const link = document.createElement("link")
      link.id = LINK_ID
      link.rel = "stylesheet"
      link.href = font.href!
      link.onload = () => resolve()
      link.onerror = () => {
        link.remove()
        reject(new Error(`Google Fonts has no family named "${font.family}".`))
      }
      document.head.append(link)
    })
    await document.fonts.load(`16px "${font.family}"`).catch(() => [])
  } else if (font.data) {
    const face = new FontFace(font.family, `url(${font.data})`)
    try {
      await face.load()
    } catch {
      throw new Error("That file could not be read as a font.")
    }
    document.fonts.add(face)
  }
  for (const name of VARIABLES) root.style.setProperty(name, fontStack(font.family))
}

/**
 * Applies and remembers a font; `null` restores the default typeface.
 * Resolves to false when the font is applied but too large to remember.
 */
export async function saveFont(font: SavedFont | null) {
  await applyFont(font)
  try {
    if (font) localStorage.setItem(FONT_STORAGE, JSON.stringify(font))
    else localStorage.removeItem(FONT_STORAGE)
    return true
  } catch {
    return false
  }
}
