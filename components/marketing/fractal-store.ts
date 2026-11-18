// Shared state between the fixed fractal canvas and its controls in the hero.
type Snapshot = { paused: boolean; label: string }

let snapshot: Snapshot = { paused: false, label: "" }
const listeners = new Set<() => void>()

function update(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next }
  listeners.forEach((listener) => listener())
}

export const fractalStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  get: () => snapshot,
  togglePaused: () => update({ paused: !snapshot.paused }),
  setLabel(label: string) {
    if (label !== snapshot.label) update({ label })
  },
}
