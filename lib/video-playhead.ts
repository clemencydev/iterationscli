/** A source-local position also identifies the frame at a boundary between files. */
export type VideoPlayhead = {
  source: number
  blob: string
  seconds: number
  ended: boolean
}

const positions = new Map<string, VideoPlayhead>()
const key = (id: string) => `iterations:video-playhead:${id}`
type Listener = (position: VideoPlayhead, sender: symbol) => void
const listeners = new Map<string, Set<Listener>>()

export function readPlayhead(id: string): VideoPlayhead | undefined {
  const current = positions.get(id)
  if (current) return current
  try {
    const saved = JSON.parse(localStorage.getItem(key(id)) ?? "null")
    if (saved && Number.isInteger(saved.source) && saved.source >= 0 &&
        typeof saved.blob === "string" && Number.isFinite(saved.seconds) &&
        saved.seconds >= 0 && typeof saved.ended === "boolean") {
      positions.set(id, saved)
      return saved
    }
  } catch { /* Playback still works when browser storage is unavailable. */ }
}

export function writePlayhead(id: string, position: VideoPlayhead, sender: symbol, publish = true) {
  positions.set(id, position)
  if (!publish) return
  try { localStorage.setItem(key(id), JSON.stringify(position)) } catch { /* Session only. */ }
  listeners.get(id)?.forEach((listen) => listen(position, sender))
}

export function watchPlayhead(id: string, listen: Listener) {
  const group = listeners.get(id) ?? new Set<Listener>()
  group.add(listen)
  listeners.set(id, group)
  return () => {
    group.delete(listen)
    if (!group.size) listeners.delete(id)
  }
}
