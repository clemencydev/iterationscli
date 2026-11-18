// Deep-zoom Mandelbrot arithmetic.
//
// Doubles run out of digits around a span of 1e-13, so the zoom is computed
// with perturbation theory instead: one reference orbit Z at the centre of the
// view is iterated in arbitrary precision (BigInt fixed point), and every pixel
// only tracks its small difference d from that orbit, which fits in a float.
//
//   z = Z + d      d' = 2·Z·d + d² + dc      (dc = the pixel's offset from the centre)
//
// The difference is stored scaled, d = δ / 2^exponent, with the exponent kept
// as an integer, so spans far below the float32 range (1e-38) still work on
// the GPU. `perturb` below is the same
// routine the fragment shader runs; the tests check it against the BigInt
// iteration.

export type Complex = { re: bigint; im: bigint }

/** Parses a decimal string into fixed point with `bits` fractional bits. */
export function parseFixed(text: string, bits: number): bigint {
  const negative = text.startsWith("-")
  const [whole, fraction = ""] = text.replace(/^[-+]/, "").split(".")
  const value =
    (BigInt(whole + fraction) << BigInt(bits)) / 10n ** BigInt(fraction.length)
  return negative ? -value : value
}

/** Fixed point to the nearest double, exact even for very small values. */
export function fixedToNumber(value: bigint, bits: number): number {
  if (value === 0n) return 0
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const shift = Math.max(0, magnitude.toString(2).length - 64)
  const result = Number(magnitude >> BigInt(shift)) * 2 ** (shift - bits)
  return negative ? -result : result
}

export function formatFixed(value: bigint, bits: number, digits: number) {
  const negative = value < 0n
  const scaled =
    ((negative ? -value : value) * 10n ** BigInt(digits)) >> BigInt(bits)
  const text = scaled.toString().padStart(digits + 1, "0")
  return `${negative ? "-" : ""}${text.slice(0, -digits)}.${text.slice(-digits)}`
}

/** Fractional bits needed to resolve a view `octaves` halvings below 1. */
export function precisionFor(octaves: number) {
  return Math.ceil(octaves) + 96
}

/** Floats per orbit entry: re mantissa, im mantissa, shared binary exponent. */
export const ORBIT_STRIDE = 3

/**
 * Iterates z → z² + c from 0 at the given precision and returns the orbit
 * Z₀…Z_{n-1}. Each entry is (re, im, e) meaning (re + i·im)·2^e with the larger
 * of |re|, |im| in [0.5, 1). Keeping the exponent apart matters: next to a deep
 * minibrot the orbit passes far closer to 0 than a float32 can express.
 * Stops after `limit` entries or once the orbit has escaped.
 */
export function referenceOrbit(c: Complex, bits: number, limit: number) {
  const shift = BigInt(bits)
  const orbit = new Float64Array(limit * ORBIT_STRIDE)
  const escape = 1n << (shift + 10n)
  let re = 0n
  let im = 0n
  let length = 0
  while (length < limit) {
    const absRe = re < 0n ? -re : re
    const absIm = im < 0n ? -im : im
    const larger = absRe > absIm ? absRe : absIm
    if (larger > 0n) {
      const width = larger.toString(2).length
      const drop = BigInt(Math.max(0, width - 60))
      const unit = 2 ** Math.min(width, 60)
      const at = length * ORBIT_STRIDE
      orbit[at] = Number(re >> drop) / unit
      orbit[at + 1] = Number(im >> drop) / unit
      orbit[at + 2] = width - bits
    }
    length++
    const re2 = (re * re) >> shift
    const im2 = (im * im) >> shift
    if (re2 + im2 > escape) break
    im = ((re * im) >> (shift - 1n)) + c.im
    re = re2 - im2 + c.re
  }
  return { orbit: orbit.subarray(0, length * ORBIT_STRIDE), length }
}

/** Squared escape radius. Large, so the smooth iteration count is accurate. */
export const BAILOUT = 65536
const RESCALE_ABOVE = 2 ** 40
const RESCALE_STEP = 20
/** Smallest power of two a float32 holds without going subnormal. */
const MIN_EXPONENT = -126

/**
 * Perturbation iteration for one pixel. The pixel sits at
 * centre + (x, y)·2^exponent. Returns the smooth iteration count, or -1 when
 * the point has not escaped after `maxIterations`.
 *
 * d is the pixel's distance from the reference orbit in units of 2^e, so it
 * stays near 1 however deep the zoom is; e climbs as the orbits drift apart.
 * With `single` set every operation is rounded to float32, which reproduces
 * what the GPU computes.
 */
export function perturb(
  orbit: ArrayLike<number>,
  length: number,
  x: number,
  y: number,
  exponent: number,
  maxIterations: number,
  single = false
): number {
  const f = single ? Math.fround : (value: number) => value
  const power = (e: number) => (e < MIN_EXPONENT ? 0 : 2 ** e)
  let cx = f(x)
  let cy = f(y)
  let dx = 0
  let dy = 0
  let e = exponent
  let scale = power(e)
  let m = 0
  let zr = f(orbit[0] * power(orbit[2]))
  let zi = f(orbit[1] * power(orbit[2]))
  for (let n = 0; n < maxIterations; n++) {
    // d' = 2·Z·d + scale·d² + c
    const nx = f(
      f(f(2 * f(f(zr * dx) - f(zi * dy))) + f(scale * f(f(dx * dx) - f(dy * dy)))) + cx
    )
    const ny = f(
      f(f(2 * f(f(zr * dy) + f(zi * dx))) + f(scale * f(2 * f(dx * dy)))) + cy
    )
    dx = nx
    dy = ny
    m++
    const at = m * ORBIT_STRIDE
    zr = f(orbit[at] * power(orbit[at + 2]))
    zi = f(orbit[at + 1] * power(orbit[at + 2]))
    const fx = f(zr + f(scale * dx))
    const fy = f(zi + f(scale * dy))
    const magnitude = f(f(fx * fx) + f(fy * fy))
    if (magnitude > BAILOUT) {
      return n + 2 - Math.log2(Math.log2(magnitude))
    }
    // Rebase: when the pixel's orbit comes closer to 0 than to the reference,
    // measure it from the start of the reference instead. This keeps d small
    // relative to Z (no glitches) and lets a short, periodic reference serve
    // any number of iterations. w is the full orbit value in units of 2^e.
    const lift = 2 ** Math.min(60, Math.max(-60, orbit[at + 2] - e))
    const wx = f(f(orbit[at] * lift) + dx)
    const wy = f(f(orbit[at + 1] * lift) + dy)
    const dd = f(f(dx * dx) + f(dy * dy))
    if (m === length - 1 || f(f(wx * wx) + f(wy * wy)) < dd) {
      dx = wx
      dy = wy
      m = 0
      zr = f(orbit[0] * power(orbit[2]))
      zi = f(orbit[1] * power(orbit[2]))
    }
    if (f(f(dx * dx) + f(dy * dy)) > RESCALE_ABOVE) {
      const down = 2 ** -RESCALE_STEP
      dx = f(dx * down)
      dy = f(dy * down)
      cx = f(cx * down)
      cy = f(cy * down)
      e += RESCALE_STEP
      scale = power(e)
    }
  }
  return -1
}

/**
 * Plain arbitrary-precision iteration of one point. Slow; the ground truth the
 * perturbation routine is tested against.
 */
export function iterateExact(c: Complex, bits: number, maxIterations: number) {
  const shift = BigInt(bits)
  const bailout = BigInt(BAILOUT) << shift
  let re = 0n
  let im = 0n
  for (let n = 0; n < maxIterations; n++) {
    const next = ((re * im) >> (shift - 1n)) + c.im
    re = ((re * re - im * im) >> shift) + c.re
    im = next
    const magnitude = (re * re + im * im) >> shift
    if (magnitude > bailout) {
      return n + 2 - Math.log2(Math.log2(fixedToNumber(magnitude, bits)))
    }
  }
  return -1
}
