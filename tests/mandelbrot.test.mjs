import test from "node:test"
import assert from "node:assert/strict"
import {
  formatFixed,
  iterateExact,
  parseFixed,
  perturb,
  precisionFor,
  referenceOrbit,
} from "../lib/mandelbrot/math.ts"
import {
  advance,
  iterationLimit,
  lastKeyframe,
  magnification,
  pickPreset,
  spanAt,
  wantedKeyframes,
} from "../lib/mandelbrot/journey.ts"
import { ZOOM_PRESETS } from "../lib/mandelbrot/presets.ts"

// A pixel at centre + (x, y)·2^exponent, as an exact fixed-point number.
function offset(centre, x, y, exponent, bits) {
  const lift = (value) => {
    const scaled = BigInt(Math.round(value * 2 ** 40))
    const shift = bits - 40 + exponent
    return shift >= 0 ? scaled << BigInt(shift) : scaled >> BigInt(-shift)
  }
  return { re: centre.re + lift(x), im: centre.im + lift(y) }
}

const SAMPLES = []
for (let i = 0; i < 24; i++) {
  const angle = i * 2.399963
  const radius = 0.08 + 0.7 * Math.sqrt((i + 0.5) / 24)
  // Multiples of 2^-20, so float32 and the fixed-point offset agree exactly.
  SAMPLES.push([
    Math.round(radius * Math.cos(angle) * 2 ** 20) / 2 ** 20,
    Math.round(radius * Math.sin(angle) * 2 ** 20) / 2 ** 20,
  ])
}

test("decimal strings survive the trip through fixed point", () => {
  const text = "-0.743643887037158704752191506114774"
  // Fixed point truncates, so compare a few digits short of the end.
  assert.equal(formatFixed(parseFixed(text, 256), 256, 30), text.slice(0, -3))
  assert.equal(formatFixed(parseFixed("1.5", 64), 64, 3), "1.500")
})

test("perturbation agrees with direct iteration on the whole set", () => {
  const bits = 128
  const centre = { re: parseFixed("-0.75", bits), im: parseFixed("0.1", bits) }
  const { orbit, length } = referenceOrbit(centre, bits, 600)
  let escaped = 0
  for (const [x, y] of SAMPLES) {
    const exact = iterateExact(offset(centre, x, y, 1, bits), bits, 500)
    const fast = perturb(orbit, length, x, y, 1, 500)
    if (exact >= 0) escaped++
    assert.ok(Math.abs(exact - fast) < 1e-6, `${x}, ${y}: ${exact} vs ${fast}`)
  }
  assert.ok(escaped > 5)
})

test("every preset is a real minibrot nucleus", () => {
  assert.ok(ZOOM_PRESETS.length >= 6)
  assert.ok(ZOOM_PRESETS.some((preset) => preset.name === "God's Eye"))
  assert.equal(new Set(ZOOM_PRESETS.map((p) => p.id)).size, ZOOM_PRESETS.length)
  for (const preset of ZOOM_PRESETS) {
    const bits = precisionFor(preset.depth + 2)
    const centre = {
      re: parseFixed(preset.re, bits),
      im: parseFixed(preset.im, bits),
    }
    const { orbit, length } = referenceOrbit(centre, bits, preset.period + 1)
    assert.equal(length, preset.period + 1, preset.id)
    // After one period the orbit is back at 0, far closer than a final pixel.
    const back = orbit[preset.period * 3 + 2]
    const pixel = spanAt(preset.depth).exponent - 12
    assert.ok(
      orbit[preset.period * 3] === 0 || back < pixel - 8,
      `${preset.id}: returns to 2^${back}`
    )
    // ...and not before, so the stated period is the true one.
    for (let i = 1; i < preset.period; i++)
      assert.ok(orbit[i * 3 + 2] > back + 20, `${preset.id}: early return at ${i}`)
  }
})

test("deep frames match arbitrary-precision iteration, in float32 too", () => {
  for (const preset of ZOOM_PRESETS) {
    const bits = precisionFor(preset.depth + 2)
    const centre = {
      re: parseFixed(preset.re, bits),
      im: parseFixed(preset.im, bits),
    }
    const { orbit, length } = referenceOrbit(centre, bits, preset.period + 1)
    const single = Float32Array.from(orbit)
    // A little short of the end, where the frame is all escaping detail.
    const octave = preset.depth - 6
    const limit = iterationLimit(preset, octave)
    const { mantissa, exponent } = spanAt(octave)
    let escaped = 0
    let close = 0
    for (const [x, y] of SAMPLES.slice(0, 12)) {
      const exact = iterateExact(
        offset(centre, x * mantissa, y * mantissa, exponent, bits),
        bits,
        limit
      )
      const double = perturb(orbit, length, x * mantissa, y * mantissa, exponent, limit)
      assert.equal(exact < 0, double < 0, `${preset.id} ${x}, ${y}`)
      assert.ok(
        Math.abs(exact - double) < 0.05,
        `${preset.id} ${x}, ${y}: ${exact} vs ${double}`
      )
      if (exact < 0) continue
      escaped++
      const float = perturb(single, length, x * mantissa, y * mantissa, exponent, limit, true)
      assert.ok(float >= 0, `${preset.id} ${x}, ${y}: float32 did not escape`)
      if (Math.abs(exact - float) < 0.25) close++
    }
    // Float32 rounding moves individual pixels in the densest filaments (the
    // picture is unchanged), so only most of them have to agree closely.
    assert.ok(escaped >= 6, `${preset.id}: ${escaped} samples escaped`)
    assert.ok(close >= escaped * 0.5, `${preset.id}: ${close}/${escaped} in float32`)
  }
})

test("iteration limits never drop as the zoom deepens", () => {
  for (const preset of ZOOM_PRESETS) {
    let previous = 0
    for (let octave = 0; octave <= lastKeyframe(preset); octave++) {
      const limit = iterationLimit(preset, octave)
      assert.ok(limit >= previous && limit >= 100, `${preset.id} @ ${octave}`)
      previous = limit
    }
  }
})

test("the camera never passes the keyframes that are ready", () => {
  let position = 0
  for (let i = 0; i < 600; i++) {
    const next = advance(position, 1 / 60, 5, 40)
    assert.ok(next >= position && next <= 4)
    position = next
  }
  assert.ok(position > 3.9)
  assert.equal(advance(2, 1, 2, 40), 2)
  assert.equal(advance(39.5, 100, 60, 40), 40)
})

test("keyframes are requested from the current octave outwards", () => {
  const preset = { depth: 10, iterations: [[0, 200]] }
  assert.deepEqual(wantedKeyframes(0, preset), [0, 1, 2, 3])
  assert.deepEqual(wantedKeyframes(8.7, preset), [8, 9, 10, 11])
  assert.deepEqual(wantedKeyframes(10, preset), [10, 11])
})

test("a reload never shows the preset it showed last", () => {
  let seed = 7
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  let last = null
  const seen = new Set()
  for (let i = 0; i < 400; i++) {
    const preset = pickPreset(ZOOM_PRESETS, last, random)
    assert.notEqual(preset.id, last)
    last = preset.id
    seen.add(last)
  }
  assert.equal(seen.size, ZOOM_PRESETS.length)
  assert.equal(pickPreset(ZOOM_PRESETS.slice(0, 1), ZOOM_PRESETS[0].id), ZOOM_PRESETS[0])
})

test("magnification reads as a power of ten", () => {
  assert.equal(magnification(0), "1.0e+0×")
  assert.equal(magnification(10), "1.0e+3×")
  assert.equal(magnification(100), "1.3e+30×")
})
