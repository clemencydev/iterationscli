/** Length and reading time of a document's plain text. */
export function describeDocument(text: string) {
  const trimmed = text.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0
  return {
    words,
    characters: trimmed.length,
    /** Minutes at ~200 words per minute; 0 for an empty document. */
    minutes: words ? Math.max(1, Math.round(words / 200)) : 0,
  }
}
