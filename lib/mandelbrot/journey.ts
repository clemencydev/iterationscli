// Timing and bookkeeping for the zoom. No rendering in here.
//
// The zoom is measured in octaves: position p shows a view whose height spans
// START_SPAN · 2^-p. Whole-number positions are "keyframes", rendered once and
// then scaled on screen, so the camera may only move as far as the keyframes
// that are already finished.
import type { ZoomPreset } from "./presets.ts"

export const START_SPAN = 3
export const OCTAVES_PER_SECOND = 0.5
/** The camera eases to a stop over this many octaves. */
const EASE_OCTAVES = 0.4
/** Keyframes kept ahead of the one filling the screen. */
export const LOOKAHEAD = 3

/** A view height as mantissa · 2^exponent with the mantissa in [1, 2). */
export function spanAt(octave: number) {
  const exponent = Math.floor(Math.log2(START_SPAN)) - octave
  return { mantissa: START_SPAN / 2 ** Math.floor(Math.log2(START_SPAN)), exponent }
}

/** Iteration limit for a keyframe, interpolated from the preset's table. */
export function iterationLimit(preset: ZoomPreset, octave: number) {
  const table = preset.iterations
  if (octave <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [o1, n1] = table[i]
    if (octave <= o1) {
      const [o0, n0] = table[i - 1]
      return Math.ceil(n0 + ((n1 - n0) * (octave - o0)) / (o1 - o0))
    }
  }
  return table[table.length - 1][1]
}

/** The last keyframe a preset needs: one past its depth, for the sharp centre. */
export function lastKeyframe(preset: ZoomPreset) {
  return preset.depth + 1
}

/**
 * Moves the camera forward. `ready` is the newest finished keyframe in an
 * unbroken run from the current one; the camera stays a full octave behind it
 * so there is always a sharper frame to blend into the centre.
 */
export function advance(
  position: number,
  seconds: number,
  ready: number,
  depth: number
) {
  const limit = Math.min(depth, ready - 1)
  const room = limit - position
  if (room <= 0) return position
  const speed = OCTAVES_PER_SECOND * Math.min(1, room / EASE_OCTAVES + 0.03)
  return Math.min(limit, position + speed * seconds)
}

/** Keyframes wanted for a camera position, nearest first. */
export function wantedKeyframes(position: number, preset: ZoomPreset) {
  const first = Math.min(Math.floor(position), preset.depth)
  const last = Math.min(first + LOOKAHEAD, lastKeyframe(preset))
  const wanted: number[] = []
  for (let k = first; k <= last; k++) wanted.push(k)
  return wanted
}

/** A random preset that is not the one shown last time. */
export function pickPreset(
  presets: readonly ZoomPreset[],
  previousId: string | null,
  random: () => number = Math.random
) {
  const choices = presets.filter((preset) => preset.id !== previousId)
  const pool = choices.length ? choices : presets
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

/** "1.3e+24×" style magnification for a camera position. */
export function magnification(position: number) {
  const log = position * Math.log10(2)
  const power = Math.floor(log)
  return `${(10 ** (log - power)).toFixed(1)}e+${power}×`
}
