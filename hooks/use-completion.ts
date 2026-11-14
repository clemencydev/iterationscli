"use client"

import { useMemo, useState, type KeyboardEvent } from "react"
import {
  applyCompletion,
  complete,
  ghostText,
  tabComplete,
  type Candidate,
  type Completion,
  type CompletionCommand,
  type Sources,
} from "@/lib/completion"

type Cycle = {
  base: string
  completion: Completion
  index: number
  shown: string
}

/**
 * Tab-completion and inline suggestions for a command prompt.
 * Tab completes (repeat to cycle, Shift+Tab backwards); → or End at the end of
 * the line accepts the dimmed suggestion.
 */
export function useCompletion(
  input: string,
  setInput: (value: string) => void,
  registry: Record<string, CompletionCommand>,
  sources: Sources = {},
  enabled = true
) {
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const live = useMemo(
    () => complete(enabled ? input : "", registry, sources),
    [enabled, input, registry, sources]
  )
  const cycling = enabled && cycle !== null && cycle.shown === input
  const completion = cycling ? cycle.completion : live
  const suggestion = enabled && !cycling ? ghostText(input, live) : ""
  const isHint = !live.candidates.length
  const candidates: Candidate[] = enabled && input.trim() ? completion.candidates : []

  function accept(value: string) {
    const base = cycling ? cycle.base : input
    setInput(applyCompletion(base, completion, value))
    setCycle(null)
  }
  /** Returns true when the key was used for completion. */
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!enabled || e.ctrlKey || e.altKey || e.metaKey) return false
    const atEnd =
      e.currentTarget.selectionStart === input.length &&
      e.currentTarget.selectionEnd === input.length
    if (e.key === "Tab" && input.trim()) {
      const next = tabComplete(
        cycling ? cycle.base : input,
        completion,
        cycling ? cycle.index : null,
        e.shiftKey
      )
      if (!next) return false
      e.preventDefault()
      setInput(next.input)
      setCycle(
        next.index >= 0 && completion.candidates.length > 1
          ? {
              base: cycling ? cycle.base : input,
              completion,
              index: next.index,
              shown: next.input,
            }
          : null
      )
      return true
    }
    if (
      (e.key === "ArrowRight" || e.key === "End") &&
      atEnd &&
      suggestion &&
      !isHint
    ) {
      e.preventDefault()
      setInput(input + suggestion)
      return true
    }
    return false
  }
  return {
    candidates,
    /** Candidate currently filled in by Tab cycling, or -1. */
    active: cycling ? cycle.index : -1,
    /** Dimmed text to draw after the caret. */
    suggestion,
    accept,
    onKeyDown,
  }
}
