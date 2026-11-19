"use client"

import { useCallback, useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import {
  DEFAULT_SCHEME,
  findScheme,
  isDark,
  SCHEME_STORAGE,
  schemeTokens,
} from "./themes"

type Saved = {
  id: string
  tokens: Record<string, string>
  /** Light/dark setting from before the scheme, restored with the default. */
  mode?: string
}
const CHANGED = "iterations:scheme-changed"

function readSaved(): Saved | null {
  try {
    const value = JSON.parse(localStorage.getItem(SCHEME_STORAGE) ?? "null")
    return value && typeof value.id === "string" && findScheme(value.id)
      ? (value as Saved)
      : null
  } catch {
    return null
  }
}

/** The site theme chosen on this device: a scheme id, or "default". */
export const readScheme = () => readSaved()?.id ?? DEFAULT_SCHEME

/**
 * Puts a scheme's colors on the page and remembers it for every page of the
 * site. Returns the light/dark mode the page should be in, or the mode to go
 * back to when the default is restored.
 */
function applyScheme(id: string, currentMode: string | undefined) {
  const root = document.documentElement
  const previous = readSaved()
  for (const name of Object.keys(previous?.tokens ?? {}))
    root.style.removeProperty(name)
  const scheme = findScheme(id)
  if (!scheme) {
    delete root.dataset.scheme
    try {
      localStorage.removeItem(SCHEME_STORAGE)
    } catch {
      // Nothing was saved, so there is nothing to forget.
    }
    return previous?.mode ?? currentMode
  }
  const tokens = schemeTokens(scheme)
  for (const [name, value] of Object.entries(tokens))
    root.style.setProperty(name, value)
  root.dataset.scheme = scheme.id
  try {
    localStorage.setItem(
      SCHEME_STORAGE,
      JSON.stringify({
        id: scheme.id,
        tokens,
        mode: previous?.mode ?? currentMode,
      } satisfies Saved)
    )
  } catch {
    // The scheme still holds until the page is closed.
  }
  return isDark(scheme) ? "dark" : "light"
}

/**
 * Puts the saved scheme back on the page. The script in app/layout.tsx does
 * this before the first paint; this repeats it once the page is running, in
 * case rendering replaced what the script had set.
 */
export function restoreScheme() {
  const saved = readSaved()
  if (!saved) return
  const root = document.documentElement
  for (const [name, value] of Object.entries(saved.tokens))
    root.style.setProperty(name, value)
  root.dataset.scheme = saved.id
}

const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGED, notify)
  return () => window.removeEventListener(CHANGED, notify)
}

/**
 * The site theme and a way to change it. A scheme decides light or dark
 * itself; going back to "default" restores the mode from before.
 */
export function useSiteScheme(): [string, (id: string) => void] {
  const { theme, setTheme } = useTheme()
  const scheme = useSyncExternalStore(
    subscribe,
    readScheme,
    () => DEFAULT_SCHEME
  )
  const choose = useCallback(
    (id: string) => {
      const mode = applyScheme(id, theme)
      if (mode) setTheme(mode)
      window.dispatchEvent(new Event(CHANGED))
    },
    [theme, setTheme]
  )
  return [scheme, choose]
}
