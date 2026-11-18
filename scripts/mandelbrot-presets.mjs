// Finds the deep-zoom destinations for the marketing background and writes
// lib/mandelbrot/presets.ts.
//
//   node scripts/mandelbrot-presets.mjs                 regenerate presets.ts
//   node scripts/mandelbrot-presets.mjs --preview dir   also write PNG stills
//   node scripts/mandelbrot-presets.mjs --only eye      limit to matching ids
//   node scripts/mandelbrot-presets.mjs --trail         only print what each hop finds
//
// Every destination is the nucleus of a minibrot: a point whose orbit returns
// to 0 exactly, so the picture at the end of the zoom is a tiny copy of the
// whole set. A path is a list of hops. Each hop looks at a spot beside the
// previous minibrot (given in that minibrot's own coordinates, where it looks
// like the full set), finds the lowest-period nucleus in a small box there,
// and refines it with Newton's method at full precision.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { deflateSync, crc32 } from "node:zlib"
import { formatFixed, perturb, referenceOrbit } from "../lib/mandelbrot/math.ts"

const BITS = 320
const SHIFT = BigInt(BITS)
const ONE = 1n << SHIFT
const fixed = (value) => BigInt(Math.round(value * 2 ** 52)) << (SHIFT - 52n)
const mul = (a, b) => (a * b) >> SHIFT
const args = process.argv.slice(2)
const option = (name) =>
  args.includes(name) ? (args[args.indexOf(name) + 1] ?? "") : null

// id, name, hops [re, im, box half-width] in the coordinates of the previous
// minibrot, and how many minibrot-widths the final frame spans.
const PATHS = option("--paths")
  ? JSON.parse(readFileSync(option("--paths"), "utf8"))
  : [
      // Off the lightning on top of the set, down to a ringed iris with a
      // minibrot for a pupil.
      path("gods-eye", "God's Eye", [
        [-0.1592, 1.0338, 0.004],
        [-3, 2, 1],
        [2, -3, 1],
        [10, 6, 3],
        [3, 2, 1],
      ]),
      path("seahorse-valley", "Seahorse Valley", [
        [-0.7436, 0.1318, 0.002],
        [3, 2, 1],
        [10, 6, 3],
      ]),
      path("abyss", "Abyss", [
        [-0.7436, 0.1318, 0.002],
        [3, 2, 1],
        [10, 6, 3],
        [-8, 5, 3],
      ]),
      path("triple-spiral", "Triple Spiral", [
        [-0.088, 0.654, 0.004],
        [-3, 2, 1],
        [2, -3, 1],
        [10, 6, 3],
      ]),
      path("quad-spiral", "Quad Spiral", [
        [0.274, 0.482, 0.004],
        [-3, 2, 1],
        [2, -3, 1],
      ]),
      path("needle", "The Needle", [
        [-1.7687, 0.0017, 0.002],
        [3, 2, 1],
        [10, 6, 3],
      ]),
      path("western-bulbs", "Western Bulbs", [
        [-1.2553, 0.0382, 0.003],
        [3, 2, 1],
        [3, 2, 1],
      ]),
      path("elephant-valley", "Elephant Valley", [
        [0.2925, 0.0149, 0.004],
        [-2, 3, 1],
        [3, 2, 1],
        [10, 6, 3],
      ]),
    ]

function path(id, name, hops, finish = 5) {
  return { id, name, hops, finish }
}

function crossesPositiveReal(a, b) {
  if (a.im < 0n === b.im < 0n) return false
  const dre = b.re - a.re
  const dim = b.im - a.im
  const side = dim * a.re - dre * a.im
  return dim < 0n === side < 0n
}

/** Lowest period with a nucleus inside the square of half-width r around c. */
function boxPeriod(c, r, limit) {
  const corners = [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
  ].map(([dx, dy]) => ({ re: c.re + dx, im: c.im + dy }))
  const z = corners.map(() => ({ re: 0n, im: 0n }))
  for (let period = 1; period <= limit; period++) {
    for (let k = 0; k < 4; k++) {
      const { re, im } = z[k]
      z[k] = {
        re: mul(re, re) - mul(im, im) + corners[k].re,
        im: (mul(re, im) << 1n) + corners[k].im,
      }
      const far = ONE << 8n
      if (z[k].re > far || z[k].re < -far || z[k].im > far || z[k].im < -far)
        return 0
    }
    let crossings = 0
    for (let k = 0; k < 4; k++)
      if (crossesPositiveReal(z[k], z[(k + 1) % 4])) crossings++
    if (crossings & 1) return period
  }
  return 0
}

/** Newton's method on z_period(c) = 0. */
function nucleus(guess, period) {
  let c = guess
  for (let step = 0; step < 80; step++) {
    let z = { re: 0n, im: 0n }
    let d = { re: 0n, im: 0n }
    for (let i = 0; i < period; i++) {
      d = {
        re: ((mul(z.re, d.re) - mul(z.im, d.im)) << 1n) + ONE,
        im: (mul(z.re, d.im) + mul(z.im, d.re)) << 1n,
      }
      z = {
        re: mul(z.re, z.re) - mul(z.im, z.im) + c.re,
        im: (mul(z.re, z.im) << 1n) + c.im,
      }
      // An escaping start would square its way to an enormous number.
      const far = ONE << 8n
      if (z.re > far || z.re < -far || z.im > far || z.im < -far) return null
    }
    const norm = d.re * d.re + d.im * d.im
    if (norm === 0n) return null
    const stepRe = ((z.re * d.re + z.im * d.im) << SHIFT) / norm
    const stepIm = ((z.im * d.re - z.re * d.im) << SHIFT) / norm
    c = { re: c.re - stepRe, im: c.im - stepIm }
    const size =
      (stepRe < 0n ? -stepRe : stepRe) + (stepIm < 0n ? -stepIm : stepIm)
    if (size < 1n << 12n) return c
    if (size > ONE << 4n) return null
  }
  return null
}

/** Size and orientation of the minibrot at a nucleus, as a complex double. */
function miniSize(c, period) {
  const { orbit } = referenceOrbit(c, BITS, period)
  let lr = 1
  let li = 0
  let br = 1
  let bi = 0
  for (let i = 1; i < period; i++) {
    const zr = orbit[i * 3] * 2 ** orbit[i * 3 + 2]
    const zi = orbit[i * 3 + 1] * 2 ** orbit[i * 3 + 2]
    // Back at 0 already: the real period is a divisor of this one.
    if (Math.abs(zr) + Math.abs(zi) < 1e-60) return null
    const nr = 2 * (zr * lr - zi * li)
    li = 2 * (zr * li + zi * lr)
    lr = nr
    const n = lr * lr + li * li
    br += lr / n
    bi -= li / n
  }
  // 1 / (b * l^2)
  const l2r = lr * lr - li * li
  const l2i = 2 * lr * li
  const pr = br * l2r - bi * l2i
  const pi = br * l2i + bi * l2r
  const n = pr * pr + pi * pi
  return { re: pr / n, im: -pi / n }
}

const STARTS = [[0, 0]]
for (const x of [-3, -2, -1, 0, 1, 2, 3])
  for (const y of [-3, -2, -1, 0, 1, 2, 3]) if (x || y) STARTS.push([x, y])
STARTS.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2)

function locate(path) {
  let centre = { re: 0n, im: 0n }
  let size = { re: 1, im: 0 }
  let period = 1
  const trail = []
  for (const [mr, mi, radius] of path.hops) {
    const magnitude = Math.hypot(size.re, size.im)
    // offset = size * m, kept as a double mantissa times a power of two
    const exponent = Math.floor(Math.log2(magnitude))
    const unit = 2 ** -exponent
    const or = (size.re * mr - size.im * mi) * unit
    const oi = (size.re * mi + size.im * mr) * unit
    const lift = (value) =>
      exponent >= 0
        ? fixed(value) << BigInt(exponent)
        : fixed(value) >> BigInt(-exponent)
    const aim = { re: centre.re + lift(or), im: centre.im + lift(oi) }
    const reach = lift(radius * magnitude * unit)
    let found = 0
    let next = null
    // An empty box (the spot is off the set) is retried at eight places
    // around it. A box whose corners escape before any nucleus shows up is too
    // big for the neighbourhood, so each place is also tried at smaller sizes.
    for (let attempt = 0; !next && attempt < 54; attempt++) {
      const turn = Math.floor(attempt / 6)
      const shrink = 4 ** -(attempt % 6)
      const angle = (turn * Math.PI) / 4
      const push = turn ? 2 : 0
      const guess = {
        re: aim.re + (reach * BigInt(Math.round(push * Math.cos(angle) * 1024))) / 1024n,
        im: aim.im + (reach * BigInt(Math.round(push * Math.sin(angle) * 1024))) / 1024n,
      }
      const r = lift(radius * shrink * magnitude * unit)
      found = boxPeriod(guess, r, 30000)
      if (!found) continue
      // Newton can run off to some other nucleus; only accept one in the box,
      // and start from several places in it.
      for (const [sx, sy] of STARTS) {
        const start = {
          re: guess.re + (r * BigInt(sx)) / 4n,
          im: guess.im + (r * BigInt(sy)) / 4n,
        }
        const candidate = nucleus(start, found)
        if (!candidate) continue
        const dre = candidate.re - guess.re
        const dim = candidate.im - guess.im
        if (dre > r || dre < -r || dim > r || dim < -r) continue
        const measured = miniSize(candidate, found)
        if (!measured || !Number.isFinite(measured.re + measured.im)) continue
        next = candidate
        break
      }
    }
    if (!next) throw new Error(`${path.id}: no nucleus near hop ${mr}, ${mi}`)
    centre = next
    period = found
    size = miniSize(centre, period)
    trail.push({ period, size: Math.hypot(size.re, size.im) })
  }
  return { centre, size, period, trail }
}

function percentile(values, q) {
  if (!values.length) return 0
  const sorted = Float64Array.from(values).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

function frame(orbit, length, octave, width, height, maxIterations) {
  // span = 3 * 2^-octave = 1.5 * 2^(1 - octave)
  const out = new Float64Array(width * height)
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++)
      out[j * width + i] = perturb(
        orbit,
        length,
        ((i + 0.5 - width / 2) / height) * 1.5,
        ((height / 2 - j - 0.5) / height) * 1.5,
        1 - octave,
        maxIterations
      )
  return out
}

function png(width, height, rgb) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++)
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

// Mirrors the palette in components/marketing/Mandelbrot.tsx.
function shade(v) {
  if (v < 0) return [2, 2, 3]
  const t = Math.sqrt(v)
  const band = 0.5 + 0.5 * Math.cos(t * 1.9)
  const slow = 0.5 + 0.5 * Math.cos(t * 0.23 + 1.3)
  const light = Math.pow(band, 2.2) * (0.35 + 0.65 * slow)
  const fade = Math.min(1, Math.max(0, (v - 2) / 10))
  return [
    (6 + 150 * light) * fade + 2,
    (8 + 160 * light) * fade + 2,
    (11 + 172 * light) * fade + 3,
  ]
}

if (args.includes("--selftest")) {
  // The period-3 minibrot on the antenna: nucleus -1.7548776662, width ~0.019.
  const c = nucleus({ re: fixed(-1.75), im: 0n }, 3)
  console.log(formatFixed(c.re, BITS, 30), miniSize(c, 3))
  console.log(boxPeriod({ re: fixed(-1.75), im: 0n }, fixed(0.02), 100))
  process.exit(0)
}

const previewDir = option("--preview")
const only = option("--only")
const trailOnly = args.includes("--trail")
const CAP = 60000
const LIMIT = 48000
if (previewDir) mkdirSync(previewDir, { recursive: true })

const presets = []
for (const path of PATHS) {
  if (only && !path.id.includes(only)) continue
  const started = Date.now()
  let located
  try {
    located = locate(path)
  } catch (error) {
    console.log(String(error.message))
    continue
  }
  const { centre, size, period, trail } = located
  const width = Math.hypot(size.re, size.im)
  const depth = Math.round(Math.log2(3 / (width * path.finish)))
  const summary =
    `${path.id}: period ${period}, depth ${depth} octaves (span ${(3 * 2 ** -depth).toExponential(1)}), ` +
    `trail ${trail.map((t) => `${t.period}@${t.size.toExponential(1)}`).join(" > ")}`
  if (trailOnly) {
    console.log(summary)
    continue
  }
  const { orbit, length } = referenceOrbit(centre, BITS, period + 1)
  // How many iterations each stage of the zoom needs to resolve its detail.
  const iterations = []
  for (let octave = 0; ; octave = Math.min(depth, octave + 6)) {
    const values = frame(orbit, length, octave, 64, 36, CAP)
    const escaped = values.filter((v) => v >= 0)
    // The last frame is the minibrot itself, whose outline only resolves at
    // high counts, so it gets a more generous limit than the way down. Past
    // LIMIT the pixels hugging the outline are drawn as part of it.
    const last = octave === depth
    const needed = Math.min(
      LIMIT,
      Math.ceil(percentile(escaped, last ? 0.995 : 0.975) * (last ? 1.6 : 1.3) + 150)
    )
    iterations.push([octave, Math.max(needed, iterations.at(-1)?.[1] ?? 0)])
    if (octave === depth) break
  }
  const digits = Math.ceil(depth * 0.30103) + 30
  presets.push({
    id: path.id,
    name: path.name,
    re: formatFixed(centre.re, BITS, digits),
    im: formatFixed(centre.im, BITS, digits),
    period,
    depth,
    iterations,
  })
  console.log(
    `${summary}, iterations ${iterations.map((i) => i[1]).join("/")} [${Date.now() - started}ms]`
  )
  if (previewDir) {
    const w = 240
    const h = 135
    const stops = [0.3, 0.5, 0.7, 0.85, 0.95, 1].map((f) =>
      Math.round(depth * f)
    )
    const sheet = Buffer.alloc(w * 3 * h * 2 * 3)
    stops.forEach((octave, index) => {
      const limit = iterations.find(([o]) => o >= octave)?.[1] ?? CAP
      const values = frame(orbit, length, octave, w, h, limit)
      const ox = (index % 3) * w
      const oy = Math.floor(index / 3) * h
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const [r, g, b] = shade(values[y * w + x])
          const at = ((oy + y) * w * 3 + ox + x) * 3
          sheet[at] = r
          sheet[at + 1] = g
          sheet[at + 2] = b
        }
    })
    writeFileSync(`${previewDir}/${path.id}.png`, png(w * 3, h * 2, sheet))
  }
}

if (!only && !trailOnly && !option("--paths")) {
  const body = presets
    .map(
      (p) => `  {
    id: ${JSON.stringify(p.id)},
    name: ${JSON.stringify(p.name)},
    re: "${p.re}",
    im: "${p.im}",
    period: ${p.period},
    depth: ${p.depth},
    iterations: ${JSON.stringify(p.iterations)},
  },`
    )
    .join("\n")
  writeFileSync(
    new URL("../lib/mandelbrot/presets.ts", import.meta.url),
    `// Generated by scripts/mandelbrot-presets.mjs. Do not edit by hand.

export type ZoomPreset = {
  id: string
  name: string
  /** Centre of the zoom: the nucleus of a minibrot, to full precision. */
  re: string
  im: string
  /** The centre's orbit returns to 0 after this many iterations. */
  period: number
  /** Octaves (halvings) from a span of 3 down to the final frame. */
  depth: number
  /** [octave, iteration limit] pairs, interpolated between entries. */
  iterations: [number, number][]
}

export const ZOOM_PRESETS: ZoomPreset[] = [
${body}
]
`
  )
  console.log(`wrote lib/mandelbrot/presets.ts (${presets.length} presets)`)
}
